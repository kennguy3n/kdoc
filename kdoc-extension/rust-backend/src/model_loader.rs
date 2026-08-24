use std::path::Path;
use std::sync::Arc;

use kchat_generation::{BackendAdapter, BackendConfig, BackendType, GenerationConfig, MlxBackend};
use tokio::sync::mpsc;

const THINK_OPEN: &str = "<think>";
const THINK_CLOSE: &str = "</think>";

pub struct ModelLoader {
    backend: Arc<MlxBackend>,
    model_name: Option<String>,
    model_format: Option<String>,
    ctx_size: u32,
    /// Currently loaded LoRA adapter path (None = base model).
    lora_adapter: Option<String>,
}

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

impl ModelLoader {
    pub fn new() -> Self {
        Self {
            backend: Arc::new(MlxBackend::new()),
            model_name: None,
            model_format: None,
            ctx_size: 4096,
            lora_adapter: None,
        }
    }

    pub fn is_loaded(&self) -> bool {
        self.backend.is_loaded()
    }

    pub fn model_name(&self) -> Option<&str> {
        self.model_name.as_deref()
    }

    pub fn model_format(&self) -> Option<&str> {
        self.model_format.as_deref()
    }

    pub fn backend_name(&self) -> &'static str {
        self.backend.backend_type().as_str()
    }

    pub fn ctx_size(&self) -> u32 {
        self.ctx_size
    }

    pub async fn load(&mut self, path: &str) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let p = Path::new(path);
        if !p.exists() {
            return Err(format!("Model path does not exist: {}", path).into());
        }

        // MLX backend requires a model directory (pack), not a .gguf file.
        if !p.is_dir() {
            return Err(format!(
                "MLX backend requires a model directory (pack), not a file: {}. \
                 The GGUF/llama-server path has been removed in favor of MLX.",
                path
            ).into());
        }

        // Verify it looks like an MLX pack (has config.json or model.safetensors).
        let has_config = p.join("config.json").exists();
        let has_safetensors = p.join("model.safetensors").exists()
            || p.join("model.safetensors.index.json").exists();
        if !has_config && !has_safetensors {
            return Err(format!(
                "Directory does not look like an MLX model pack (no config.json or model.safetensors): {}",
                path
            ).into());
        }

        self.unload().await;

        let ctx_size = env_or("KDOC_CTX_SIZE", "2048");
        let ctx_size_val: u32 = ctx_size.parse().unwrap_or(2048);

        let config = BackendConfig {
            backend_type: BackendType::Mlx,
            model_pack_id: p
                .file_name()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| "unknown".to_string()),
            model_path: path.to_string(),
            gpu_layers: -1,
            context_size: ctx_size_val as usize,
            threads: 4,
            batch_size: 512,
        };

        // BackendAdapter::load is sync; wrap in spawn_blocking.
        let backend = Arc::clone(&self.backend);
        let config_clone = config.clone();

        // Check for KDOC_LORA_PATH env var to load a LoRA adapter at startup.
        let lora_path = env_or("KDOC_LORA_PATH", "");
        let lora_set = !lora_path.is_empty() && Path::new(&lora_path).exists();
        if lora_set {
            backend.set_lora_path(&lora_path);
            tracing::info!("Will load LoRA adapter at startup: {}", lora_path);
        }

        tokio::task::spawn_blocking(move || backend.load(&config_clone))
            .await
            .map_err(|e| format!("load task panicked: {}", e))??;

        // Track the LoRA adapter if one was loaded at startup.
        if lora_set {
            self.lora_adapter = Some(lora_path);
        }

        self.model_name = Some(
            p.file_name()
                .or_else(|| p.file_stem())
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| path.to_string()),
        );
        self.model_format = Some("mlx".to_string());
        self.ctx_size = ctx_size_val;

        tracing::info!(
            "MLX model loaded: {} (ctx_size={})",
            self.model_name.as_deref().unwrap_or("?"),
            self.ctx_size
        );
        Ok(())
    }

    pub async fn unload(&mut self) {
        let backend = Arc::clone(&self.backend);
        let _ = tokio::task::spawn_blocking(move || backend.unload()).await;
        self.model_name = None;
        self.model_format = None;
        self.lora_adapter = None;
    }

    /// Load (or hot-swap) a LoRA adapter at runtime.
    /// The Swift server unloads the current adapter and loads the new one.
    pub async fn load_lora(&mut self, adapter_path: &str) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let backend = Arc::clone(&self.backend);
        let path = adapter_path.to_string();
        tokio::task::spawn_blocking(move || backend.load_lora(&path)).await??;
        self.lora_adapter = Some(adapter_path.to_string());
        tracing::info!("LoRA adapter loaded: {}", adapter_path);
        Ok(())
    }

    /// Detach the current LoRA adapter, reverting to the base model.
    pub async fn detach_lora(&mut self) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let backend = Arc::clone(&self.backend);
        tokio::task::spawn_blocking(move || backend.detach_lora()).await??;
        self.lora_adapter = None;
        tracing::info!("LoRA adapter detached");
        Ok(())
    }

    /// Currently loaded LoRA adapter path (None = base model only).
    pub fn lora_adapter(&self) -> Option<&str> {
        self.lora_adapter.as_deref()
    }

    pub fn chat_stream(
        &self,
        system: &str,
        user: &str,
        max_tokens: u32,
        temperature: f32,
        stop: Vec<String>,
        response_prefix: String,
    ) -> mpsc::Receiver<Result<String, Box<dyn std::error::Error + Send + Sync>>> {
        let (tx, rx) = mpsc::channel(32);

        if !self.is_loaded() {
            let _ = tx.blocking_send(Err("No model loaded".into()));
            return rx;
        }

        let ctx_size = self.ctx_size;
        let system = system.to_string();
        let user = user.to_string();
        let backend = Arc::clone(&self.backend);
        let tx_err = tx.clone();

        tokio::spawn(async move {
            if let Err(e) = proxy_chat(
                backend,
                ctx_size,
                &system,
                &user,
                max_tokens,
                temperature,
                stop,
                &response_prefix,
                tx,
            )
            .await
            {
                tracing::error!("Chat stream error: {}", e);
                let _ = tx_err.send(Err(e)).await;
            }
        });

        rx
    }
}

// ---------------------------------------------------------------------------
// Chat proxy — builds prompts, handles context-budget chunking, and runs
// the think-tag state machine over the model's output.
// ---------------------------------------------------------------------------

async fn proxy_chat(
    backend: Arc<dyn BackendAdapter>,
    ctx_size: u32,
    system: &str,
    user: &str,
    max_tokens: u32,
    temperature: f32,
    stop: Vec<String>,
    response_prefix: &str,
    tx: mpsc::Sender<Result<String, Box<dyn std::error::Error + Send + Sync>>>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // Chat template overhead: roughly 50-80 tokens for the im_start/im_end markers
    // and think tags. Use 150 as a safety margin to account for tokenizer differences.
    const TEMPLATE_OVERHEAD: u32 = 150;

    let system_tokens = estimate_tokens(system);
    let budget = ctx_size
        .saturating_sub(system_tokens)
        .saturating_sub(TEMPLATE_OVERHEAD)
        .saturating_sub(max_tokens);

    let user_tokens = estimate_tokens(user);

    if user_tokens <= budget {
        // Single call - fits in context
        single_completion(
            &backend, system, user, max_tokens, temperature, &stop, response_prefix, true, &tx,
        )
        .await?;
        return Ok(());
    }

    // Chunked processing: split user text and process each chunk sequentially.
    let available = ctx_size
        .saturating_sub(system_tokens)
        .saturating_sub(TEMPLATE_OVERHEAD);

    let chunk_budget = available / 2;
    let effective_max_tokens = available / 2;

    tracing::info!(
        "Input too large for context (user~{} tokens, chunk_budget~{} tokens, max_tokens~{}, ctx={}). Chunking enabled.",
        user_tokens, chunk_budget, effective_max_tokens, ctx_size
    );

    let chunks = chunk_text(user, chunk_budget);
    tracing::info!("Split input into {} chunks", chunks.len());

    // Emit response prefix once before the first chunk
    if !response_prefix.is_empty() {
        if tx.send(Ok(response_prefix.to_string())).await.is_err() {
            return Ok(()); // receiver dropped
        }
    }

    for (i, chunk) in chunks.iter().enumerate() {
        let is_first = i == 0;
        let prefix_in_prompt = if is_first { response_prefix } else { "" };

        let (alive, _clean_output) = single_completion(
            &backend, system, chunk, effective_max_tokens, temperature, &stop, prefix_in_prompt, false, &tx,
        )
        .await?;

        if !alive {
            break; // receiver dropped
        }
    }

    Ok(())
}

/// Make a single completion call to the MLX backend and stream the response
/// through the think-tag state machine. Returns `true` if the receiver is
/// still alive, `false` if it was dropped (client disconnected).
///
/// When `emit_response_prefix` is true, the response_prefix is sent as the
/// first token before making the request.
async fn single_completion(
    backend: &Arc<dyn BackendAdapter>,
    system: &str,
    user: &str,
    max_tokens: u32,
    temperature: f32,
    stop: &[String],
    response_prefix: &str,
    emit_response_prefix: bool,
    tx: &mpsc::Sender<Result<String, Box<dyn std::error::Error + Send + Sync>>>,
) -> Result<(bool, String), Box<dyn std::error::Error + Send + Sync>> {
    let prompt = format!(
        "<|im_start|>system\n{system}<|im_end|>\n<|im_start|>user\n{user}<|im_end|>\n<|im_start|>assistant\n{THINK_OPEN}\n\n{THINK_CLOSE}\n\n{response_prefix}",
        system = system,
        user = user,
        response_prefix = response_prefix,
    );

    if emit_response_prefix && !response_prefix.is_empty() {
        if tx.send(Ok(response_prefix.to_string())).await.is_err() {
            return Ok((false, String::new())); // receiver dropped
        }
    }

    let gen_config = GenerationConfig {
        max_tokens: max_tokens as usize,
        temperature,
        top_p: 0.9,
        top_k: 40,
        repeat_penalty: 1.1,
        grammar: None,
        seed: 0,
    };

    // BackendAdapter::generate is sync; wrap in spawn_blocking.
    let backend = Arc::clone(backend);
    let result = tokio::task::spawn_blocking(move || backend.generate(&prompt, &gen_config))
        .await
        .map_err(|e| format!("generation task panicked: {}", e))??;

    // Process the full response through the think-tag state machine and
    // forward word-sized chunks through the channel.
    let (alive, clean_output) = process_think_tags(&result.text, stop, tx).await?;
    Ok((alive, clean_output))
}

/// Process model output through the think-tag state machine, forwarding
/// clean tokens (with `<think>...</think>` stripped) through the channel.
///
/// Returns `true` if the receiver is still alive, `false` if it was dropped.
async fn process_think_tags(
    output: &str,
    stop: &[String],
    tx: &mpsc::Sender<Result<String, Box<dyn std::error::Error + Send + Sync>>>,
) -> Result<(bool, String), Box<dyn std::error::Error + Send + Sync>> {
    // Strip think tags from the full output to get the clean text.
    let clean_text = strip_think_tags(output);

    // Stop sequences are checked by the backend/server; we just forward clean text.
    let _ = stop;

    // Emit clean text as word-sized chunks for simulated streaming.
    for chunk in split_into_word_chunks(&clean_text) {
        if tx.send(Ok(chunk)).await.is_err() {
            return Ok((false, clean_text));
        }
    }

    Ok((true, clean_text))
}

/// Strip think tags from text, returning only the clean content.
fn strip_think_tags(text: &str) -> String {
    let mut result = String::new();
    let mut remaining = text;
    let mut think_depth: i32 = 0;

    loop {
        if think_depth > 0 {
            if let Some(pos) = remaining.find(THINK_CLOSE) {
                think_depth -= 1;
                remaining = &remaining[pos + THINK_CLOSE.len()..];
            } else {
                break;
            }
        } else {
            if let Some(pos) = remaining.find(THINK_OPEN) {
                result.push_str(&remaining[..pos]);
                think_depth += 1;
                remaining = &remaining[pos + THINK_OPEN.len()..];
            } else {
                result.push_str(remaining);
                break;
            }
        }
    }

    result
}

/// Split text into word-sized chunks for simulated streaming.
fn split_into_word_chunks(text: &str) -> Vec<String> {
    if text.is_empty() {
        return Vec::new();
    }

    let mut chunks = Vec::new();
    let mut current = String::new();

    for ch in text.chars() {
        current.push(ch);
        if ch.is_whitespace() && current.len() > 1 {
            chunks.push(std::mem::take(&mut current));
        }
    }

    if !current.is_empty() {
        chunks.push(current);
    }

    chunks
}

/// Rough token count estimate. Conservative to avoid context overflow.
/// ~3 chars/token for Latin, ~1.2 chars/token for CJK.
fn estimate_tokens(text: &str) -> u32 {
    let chars = text.chars().count() as f32;
    if chars == 0.0 {
        return 0;
    }
    let bytes = text.len() as f32;
    let ratio = bytes / chars;
    let chars_per_token = if ratio > 2.0 { 1.2 } else { 3.0 };
    (chars / chars_per_token).ceil() as u32
}

/// Split text into chunks that each fit within `max_tokens` tokens.
/// Splits at paragraph boundaries (double newline), then line boundaries,
/// then character boundaries as a last resort.
fn chunk_text(text: &str, max_tokens: u32) -> Vec<String> {
    if estimate_tokens(text) <= max_tokens {
        return vec![text.to_string()];
    }

    let mut chunks: Vec<String> = Vec::new();
    let mut current = String::new();

    for para in text.split("\n\n") {
        let candidate = if current.is_empty() {
            para.to_string()
        } else {
            format!("{}\n\n{}", current, para)
        };

        if estimate_tokens(&candidate) <= max_tokens {
            current = candidate;
        } else {
            if !current.is_empty() {
                chunks.push(std::mem::take(&mut current));
            }

            if estimate_tokens(para) <= max_tokens {
                current = para.to_string();
            } else {
                for line in para.split('\n') {
                    let candidate = if current.is_empty() {
                        line.to_string()
                    } else {
                        format!("{}\n{}", current, line)
                    };

                    if estimate_tokens(&candidate) <= max_tokens {
                        current = candidate;
                    } else {
                        if !current.is_empty() {
                            chunks.push(std::mem::take(&mut current));
                        }
                        if estimate_tokens(line) <= max_tokens {
                            current = line.to_string();
                        } else {
                            let max_chars = (max_tokens as f32 * 3.0) as usize;
                            let mut start = 0;
                            while start < line.len() {
                                let mut end = (start + max_chars).min(line.len());
                                while end < line.len() && !line.is_char_boundary(end) {
                                    end -= 1;
                                }
                                if !current.is_empty() {
                                    chunks.push(std::mem::take(&mut current));
                                }
                                current = line[start..end].to_string();
                                start = end;
                            }
                        }
                    }
                }
            }
        }
    }

    if !current.is_empty() {
        chunks.push(current);
    }

    if chunks.is_empty() {
        chunks.push(text.to_string());
    }

    chunks
}
