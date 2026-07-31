use std::error::Error;
use std::path::Path;
use std::sync::Arc;

use tokio::sync::{mpsc, Mutex};

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
pub struct LoadedModel {
    model: Arc<Mutex<crate::qwen35_gguf::ModelWeights>>,
    tokenizer: tokenizers::Tokenizer,
    device: candle_core::Device,
    eos_token_id: u32,
}

pub enum ModelBackend {
    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    Candle(LoadedModel),
    #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
    Unsupported,
}

pub struct ModelLoader {
    backend: Option<ModelBackend>,
    model_name: Option<String>,
    model_format: Option<String>,
}

impl ModelLoader {
    pub fn new() -> Self {
        Self {
            backend: None,
            model_name: None,
            model_format: None,
        }
    }

    pub fn is_loaded(&self) -> bool {
        self.backend.is_some()
    }

    pub fn model_name(&self) -> Option<&str> {
        self.model_name.as_deref()
    }

    pub fn model_format(&self) -> Option<&str> {
        self.model_format.as_deref()
    }

    pub fn backend_name(&self) -> &'static str {
        match &self.backend {
            #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
            Some(ModelBackend::Candle(_)) => "candle-metal",
            #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
            Some(ModelBackend::Unsupported) => "unsupported",
            None => "none",
        }
    }

    pub async fn load(&mut self, path: &str) -> Result<(), Box<dyn Error + Send + Sync>> {
        let p = Path::new(path);
        if !p.exists() {
            return Err(format!("Model path does not exist: {}", path).into());
        }

        let format = if p.extension().map(|e| e == "gguf").unwrap_or(false) {
            "gguf"
        } else {
            return Err(format!("Unknown model format: {}. Only .gguf files are supported.", path).into());
        };

        self.unload();

        #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
        {
            self.load_model(p, format)?;
            self.model_name = Some(
                p.file_name()
                    .or_else(|| p.file_stem())
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_else(|| path.to_string()),
            );
            self.model_format = Some(format.to_string());
            Ok(())
        }

        #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
        {
            let _ = format;
            Err("AI model loading is only supported on Apple Silicon (macOS/iOS) with Metal.".into())
        }
    }

    #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
    fn load_model(&mut self, path: &Path, format: &str) -> Result<(), Box<dyn Error + Send + Sync>> {
        use candle_core::Device;

        tracing::info!("Loading {} model from: {}", format, path.display());

        let device = Device::new_metal(0)?;

        let mut file = std::fs::File::open(path)?;
        let content = candle_core::quantized::gguf_file::Content::read(&mut file)?;

        let eos_token_id = content.metadata.get("tokenizer.ggml.eos_token_id")
            .and_then(|v| v.to_u32().ok())
            .unwrap_or(151643);

        let model = crate::qwen35_gguf::ModelWeights::from_gguf(content, &mut file, &device)?;
        tracing::info!("Model loaded successfully");

        let tokenizer_path = path.parent()
            .or_else(|| Some(Path::new(".")))
            .and_then(|d| {
                let candidates = ["tokenizer.json", "../tokenizer.json"];
                for c in candidates {
                    let p = d.join(c);
                    if p.exists() { return Some(p); }
                }
                None
            })
            .ok_or_else(|| "tokenizer.json not found".to_string())?;

        let tokenizer = tokenizers::Tokenizer::from_file(&tokenizer_path)
            .map_err(|e| format!("Failed to load tokenizer: {}", e))?;

        self.backend = Some(ModelBackend::Candle(LoadedModel {
            model: Arc::new(Mutex::new(model)),
            tokenizer,
            device,
            eos_token_id,
        }));

        Ok(())
    }

    pub fn unload(&mut self) {
        self.backend = None;
        self.model_name = None;
        self.model_format = None;
    }

    pub fn chat_stream(
        &mut self,
        system: &str,
        user: &str,
        max_tokens: u32,
        temperature: f32,
        stop: Vec<String>,
    ) -> mpsc::Receiver<Result<String, Box<dyn Error + Send + Sync>>> {
        let (tx, rx) = mpsc::channel(32);

        match &mut self.backend {
            #[cfg(all(target_os = "macos", target_arch = "aarch64"))]
            Some(ModelBackend::Candle(loaded)) => {
                let system = system.to_string();
                let user = user.to_string();
                let eos = loaded.eos_token_id;
                let model = loaded.model.clone();
                let tokenizer = unsafe {
                    std::mem::transmute::<&tokenizers::Tokenizer, &'static tokenizers::Tokenizer>(
                        &loaded.tokenizer,
                    )
                };
                let device = unsafe {
                    std::mem::transmute::<&candle_core::Device, &'static candle_core::Device>(
                        &loaded.device,
                    )
                };

                tokio::task::spawn_blocking(move || {
                    let mut model = model.blocking_lock();
                    let tx_clone = tx.clone();
                    if let Err(e) = stream_generate(&mut model, tokenizer, device, eos, &system, &user, max_tokens, temperature, stop, tx) {
                        let _ = tx_clone.blocking_send(Err(e));
                    }
                });
            }
            #[cfg(not(all(target_os = "macos", target_arch = "aarch64")))]
            Some(ModelBackend::Unsupported) => {
                let _ = tx.blocking_send(Err("Unsupported platform".into()));
            }
            None => {
                let _ = tx.blocking_send(Err("No model loaded".into()));
            }
        }

        rx
    }
}

#[cfg(all(target_os = "macos", target_arch = "aarch64"))]
#[allow(clippy::too_many_arguments)]
fn stream_generate(
    model: &mut crate::qwen35_gguf::ModelWeights,
    tokenizer: &tokenizers::Tokenizer,
    device: &candle_core::Device,
    eos_token_id: u32,
    system: &str,
    user: &str,
    max_tokens: u32,
    temperature: f32,
    stop: Vec<String>,
    tx: mpsc::Sender<Result<String, Box<dyn Error + Send + Sync>>>,
) -> Result<(), Box<dyn Error + Send + Sync>> {
    use candle_core::{DType, Tensor};
    use candle_transformers::generation::LogitsProcessor;

    model.clear_cache();

    let prompt = format!(
        "<|im_start|>system\n{}<|im_end|>\n<|im_start|>user\n{}<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n",
        system, user
    );

    let tokens = tokenizer
        .encode(prompt.as_str(), true)
        .map_err(|e| format!("Tokenization error: {}", e))?;
    let token_ids = tokens.get_ids().to_vec();

    let mut logits_processor = LogitsProcessor::new(299792458, Some(temperature as f64), None);

    let mut input_ids_2d = Tensor::from_slice(&token_ids, token_ids.len(), device)?.unsqueeze(0)?; // [1, seq_len]
    let mut offset = 0usize;

    let mut generated_text = String::new();

    for _ in 0..max_tokens {
        let seq_len = input_ids_2d.dim(1)?;
        let logits = model.forward(&input_ids_2d, offset)?;
        let logits = logits.to_dtype(DType::F32)?;
        let next_token = logits_processor.sample(&logits)?;

        if next_token == eos_token_id {
            break;
        }

        let token_str = tokenizer
            .decode(&[next_token], true)
            .map_err(|e| format!("Decode error: {}", e))?;

        generated_text.push_str(&token_str);

        // Skip tokens inside <think>...</think> blocks
        if generated_text.contains("<think>") && !generated_text.contains("</think>") {
            continue;
        }

        // Strip </think> remnant from the token before sending
        let clean_token = token_str.replace("</think>", "");

        let mut hit_stop = false;
        for s in &stop {
            if generated_text.contains(s) {
                hit_stop = true;
                break;
            }
        }

        if !hit_stop && !clean_token.is_empty() {
            let _ = tx.blocking_send(Ok(clean_token));
        }

        if hit_stop {
            break;
        }

        let next_tensor = Tensor::from_slice(&[next_token], 1, device)?;
        input_ids_2d = next_tensor.unsqueeze(0)?; // Only feed new token
        offset += seq_len;
    }

    Ok(())
}
