use std::path::Path;
use std::process::Stdio;
use std::time::Duration;

use futures_util::StreamExt;
use tokio::process::{Child, Command};
use tokio::sync::mpsc;

const INTERNAL_PORT: u16 = 9943;

const THINK_OPEN: &str = "<think>";
const THINK_CLOSE: &str = "</think>";

pub struct ModelLoader {
    child: Option<Child>,
    model_name: Option<String>,
    model_format: Option<String>,
    ctx_size: u32,
}

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

impl ModelLoader {
    pub fn new() -> Self {
        Self {
            child: None,
            model_name: None,
            model_format: None,
            ctx_size: 4096,
        }
    }

    pub fn is_loaded(&self) -> bool {
        self.child.is_some()
    }

    pub fn model_name(&self) -> Option<&str> {
        self.model_name.as_deref()
    }

    pub fn model_format(&self) -> Option<&str> {
        self.model_format.as_deref()
    }

    pub fn backend_name(&self) -> &'static str {
        "llama.cpp"
    }

    pub fn ctx_size(&self) -> u32 {
        self.ctx_size
    }

    pub async fn load(&mut self, path: &str) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let p = Path::new(path);
        if !p.exists() {
            return Err(format!("Model path does not exist: {}", path).into());
        }

        if !p.extension().map(|e| e == "gguf").unwrap_or(false) {
            return Err(format!("Unknown model format: {}. Only .gguf files are supported.", path).into());
        }

        self.unload().await;

        let server_bin = find_llama_server()?;

        tracing::info!("Spawning llama-server: {} -m {} --port {}", server_bin, path, INTERNAL_PORT);

        let ctx_size = env_or("KDOC_CTX_SIZE", "4096");
        let ngl = env_or("KDOC_NGL", "99");
        let threads = env_or("KDOC_THREADS", "4");

        let ctx_size_val: u32 = ctx_size.parse().unwrap_or(4096);

        let mut child = Command::new(&server_bin)
            .arg("-m").arg(path)
            .arg("--host").arg("127.0.0.1")
            .arg("--port").arg(INTERNAL_PORT.to_string())
            .arg("-c").arg(&ctx_size)
            .arg("-ngl").arg(&ngl)
            .arg("-t").arg(&threads)
            .arg("--no-warmup")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()?;

        // Stream stderr to tracing for debugging
        if let Some(stderr) = child.stderr.take() {
            let reader = tokio::io::BufReader::new(stderr);
            use tokio::io::AsyncBufReadExt;
            let mut lines = reader.lines();
            tokio::spawn(async move {
                loop {
                    match lines.next_line().await {
                        Ok(Some(line)) => tracing::info!("[llama-server] {}", line),
                        Ok(None) => break,
                        Err(e) => {
                            tracing::warn!("[llama-server] stderr read error: {}", e);
                            break;
                        }
                    }
                }
            });
        }
        // Drain stdout so it doesn't block
        if let Some(stdout) = child.stdout.take() {
            let reader = tokio::io::BufReader::new(stdout);
            use tokio::io::AsyncBufReadExt;
            let mut lines = reader.lines();
            tokio::spawn(async move {
                while let Ok(Some(_line)) = lines.next_line().await {}
            });
        }

        self.child = Some(child);

        // Wait for llama-server to be ready; clean up on failure
        if let Err(e) = wait_for_ready(INTERNAL_PORT).await {
            self.unload().await;
            return Err(e);
        }

        self.model_name = Some(
            p.file_name()
                .or_else(|| p.file_stem())
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| path.to_string()),
        );
        self.model_format = Some("gguf".to_string());
        self.ctx_size = ctx_size_val;

        tracing::info!("llama-server is ready on port {} (ctx_size={})", INTERNAL_PORT, self.ctx_size);
        Ok(())
    }

    pub async fn unload(&mut self) {
        if let Some(mut child) = self.child.take() {
            tracing::info!("Killing llama-server subprocess");
            let _ = child.kill().await;
            let _ = child.wait().await;
        }
        self.model_name = None;
        self.model_format = None;
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

        if self.child.is_none() {
            let _ = tx.blocking_send(Err("No model loaded".into()));
            return rx;
        }

        let port = INTERNAL_PORT;
        let ctx_size = self.ctx_size;
        let system = system.to_string();
        let user = user.to_string();
        let tx_err = tx.clone();

        tokio::spawn(async move {
            if let Err(e) = proxy_chat_stream(port, ctx_size, &system, &user, max_tokens, temperature, stop, &response_prefix, tx).await {
                tracing::error!("Chat stream error: {}", e);
                let _ = tx_err.send(Err(e)).await;
            }
        });

        rx
    }
}

async fn wait_for_ready(port: u16) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let url = format!("http://127.0.0.1:{}/health", port);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()?;

    for attempt in 0..60 {
        match client.get(&url).send().await {
            Ok(resp) if resp.status().is_success() => return Ok(()),
            _ => {
                tokio::time::sleep(Duration::from_millis(500)).await;
                tracing::info!("Waiting for llama-server to start... (attempt {})", attempt + 1);
            }
        }
    }
    Err("llama-server did not become ready within 30 seconds".into())
}

async fn proxy_chat_stream(
    port: u16,
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
        let alive = single_completion(
            port, system, user, max_tokens, temperature, &stop, response_prefix, true, &tx,
        ).await?;
        let _ = alive;
        return Ok(());
    }

    // Chunked processing: split user text and process each chunk sequentially
    tracing::info!(
        "Input too large for context (user~{} tokens, budget~{} tokens, ctx={}). Chunking enabled.",
        user_tokens, budget, ctx_size
    );

    let chunks = chunk_text(user, budget);
    tracing::info!("Split input into {} chunks", chunks.len());

    // Emit response prefix once before the first chunk
    if !response_prefix.is_empty() {
        if tx.send(Ok(response_prefix.to_string())).await.is_err() {
            return Ok(()); // receiver dropped
        }
    }

    for (i, chunk) in chunks.iter().enumerate() {
        let is_first = i == 0;
        // Don't emit response_prefix again (already emitted above).
        // Include it in the prompt only for the first chunk to anchor output format.
        let prefix_in_prompt = if is_first { response_prefix } else { "" };
        let alive = single_completion(
            port, system, chunk, max_tokens, temperature, &stop, prefix_in_prompt, false, &tx,
        ).await?;

        if !alive {
            break; // receiver dropped
        }
    }

    Ok(())
}

/// Make a single llama-server completion call and stream the response through
/// the think-tag state machine. Returns `true` if the receiver is still alive,
/// `false` if it was dropped (client disconnected).
///
/// When `emit_response_prefix` is true, the response_prefix is sent as the
/// first token before making the request.
async fn single_completion(
    port: u16,
    system: &str,
    user: &str,
    max_tokens: u32,
    temperature: f32,
    stop: &[String],
    response_prefix: &str,
    emit_response_prefix: bool,
    tx: &mpsc::Sender<Result<String, Box<dyn std::error::Error + Send + Sync>>>,
) -> Result<bool, Box<dyn std::error::Error + Send + Sync>> {
    let prompt = format!(
        "<|im_start|>system\n{system}<|im_end|>\n<|im_start|>user\n{user}<|im_end|>\n<|im_start|>assistant\n{THINK_OPEN}\n\n{THINK_CLOSE}\n\n{response_prefix}",
        system = system,
        user = user,
        response_prefix = response_prefix,
    );

    if emit_response_prefix && !response_prefix.is_empty() {
        if tx.send(Ok(response_prefix.to_string())).await.is_err() {
            return Ok(false); // receiver dropped
        }
    }

    let body = serde_json::json!({
        "prompt": prompt,
        "n_predict": max_tokens,
        "temperature": temperature,
        "stream": true,
        "stop": stop,
    });

    let url = format!("http://127.0.0.1:{}/completion", port);
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(300))
        .build()?;

    let resp = client
        .post(&url)
        .json(&body)
        .send()
        .await?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("llama-server returned {}: {}", status, text).into());
    }

    process_completion_stream(resp, stop, tx).await
}

/// Process a llama-server streaming response through the think-tag state machine.
/// Returns `true` if the receiver is still alive, `false` if it was dropped.
async fn process_completion_stream(
    resp: reqwest::Response,
    stop: &[String],
    tx: &mpsc::Sender<Result<String, Box<dyn std::error::Error + Send + Sync>>>,
) -> Result<bool, Box<dyn std::error::Error + Send + Sync>> {
    let mut stream = resp.bytes_stream();
    let mut buf = String::new();
    let mut generated_text = String::new();

    let mut think_depth: i32 = 0;
    let mut pending: String = String::new();

    while let Some(chunk_result) = stream.next().await {
        let chunk = match chunk_result {
            Ok(c) => c,
            Err(e) => return Err(format!("Stream read error: {}", e).into()),
        };

        buf.push_str(&String::from_utf8_lossy(&chunk));

        while let Some(nl_pos) = buf.find('\n') {
            let line = buf[..nl_pos].trim().to_string();
            buf = buf[nl_pos + 1..].to_string();

            if line.is_empty() || !line.starts_with("data: ") {
                continue;
            }

            let data = &line[6..];
            if data == "[DONE]" {
                return Ok(true);
            }

            let parsed: serde_json::Value = match serde_json::from_str(data) {
                Ok(v) => v,
                Err(_) => continue,
            };

            if let Some(stop_type) = parsed.get("stop_type").and_then(|v| v.as_str()) {
                if stop_type == "limit" {
                    let _ = tx.send(Ok("\u{0000}[CUT_OFF]\u{0000}".to_string())).await;
                }
            }

            let token = parsed
                .get("content")
                .and_then(|c| c.as_str())
                .unwrap_or("");

            if token.is_empty() {
                continue;
            }

            let full_token = if pending.is_empty() {
                token.to_string()
            } else {
                let combined = format!("{}{}", pending, token);
                pending.clear();
                combined
            };

            generated_text.push_str(&full_token);

            let mut remaining = full_token.as_str();
            let mut clean_parts: String = String::new();

            loop {
                if think_depth > 0 {
                    if let Some(pos) = remaining.find(THINK_CLOSE) {
                        think_depth -= 1;
                        remaining = &remaining[pos + THINK_CLOSE.len()..];
                    } else {
                        if let Some(partial_len) = partial_tag_prefix_len(remaining, THINK_CLOSE) {
                            pending = remaining[remaining.len() - partial_len..].to_string();
                        }
                        break;
                    }
                } else {
                    if let Some(pos) = remaining.find(THINK_OPEN) {
                        clean_parts.push_str(&remaining[..pos]);
                        think_depth += 1;
                        remaining = &remaining[pos + THINK_OPEN.len()..];
                    } else {
                        if let Some(partial_len) = partial_tag_prefix_len(remaining, THINK_OPEN) {
                            clean_parts.push_str(&remaining[..remaining.len() - partial_len]);
                            pending = remaining[remaining.len() - partial_len..].to_string();
                        } else {
                            clean_parts.push_str(remaining);
                        }
                        break;
                    }
                }
            }

            let clean_token = clean_parts;

            let mut hit_stop = false;
            for s in stop {
                if generated_text.contains(s) {
                    hit_stop = true;
                    break;
                }
            }

            if !hit_stop && !clean_token.is_empty() {
                if tx.send(Ok(clean_token)).await.is_err() {
                    return Ok(false); // receiver dropped
                }
            }

            if hit_stop {
                break;
            }
        }
    }

    Ok(true)
}

/// Check if `text` ends with a prefix of `tag`. If so, return the length of
/// the matching prefix (so the caller can hold it back for the next token).
/// Returns None if no partial match.
///
/// Example: text="hello <thi", tag="<think>" -> returns Some(4) for "<thi"
fn partial_tag_prefix_len(text: &str, tag: &str) -> Option<usize> {
    let text_bytes = text.as_bytes();
    let tag_bytes = tag.as_bytes();
    // Try the longest possible partial match (up to tag.len() - 1 chars).
    let max_len = std::cmp::min(text.len(), tag.len() - 1);
    for len in (1..=max_len).rev() {
        let suffix = &text_bytes[text_bytes.len() - len..];
        let prefix = &tag_bytes[..len];
        if suffix == prefix {
            return Some(len);
        }
    }
    None
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
                // Paragraph too big, split by lines
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
                            // Line too big, hard split at char boundary
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

fn find_llama_server() -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    if let Ok(p) = std::env::var("KDOC_LLAMA_SERVER") {
        if Path::new(&p).exists() {
            tracing::info!("Found llama-server at: {} (from KDOC_LLAMA_SERVER)", p);
            return Ok(p);
        }
    }

    let candidates = [
        "/opt/homebrew/bin/llama-server",
        "llama-server",
    ];

    for c in &candidates {
        if Path::new(c).exists() || which(c).is_some() {
            tracing::info!("Found llama-server at: {}", c);
            return Ok(c.to_string());
        }
    }

    Err("llama-server binary not found. Set KDOC_LLAMA_SERVER env var, or install via brew, or build from https://github.com/PrismML-Eng/llama.cpp (prism branch).".into())
}

fn which(bin: &str) -> Option<()> {
    std::process::Command::new(bin)
        .arg("--version")
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .ok()
        .map(|_| ())
}
