use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;

use axum::{
    extract::State,
    http::StatusCode,
    response::{sse::{Event, Sse}, IntoResponse},
    routing::{get, post},
    Json, Router,
};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tokio::sync::RwLock;
use tokio_stream::wrappers::ReceiverStream;
use tower_http::cors::CorsLayer;

mod model_loader;

use model_loader::ModelLoader;

#[derive(Clone)]
struct AppState {
    loader: Arc<RwLock<ModelLoader>>,
    model_dir: PathBuf,
}

#[derive(Deserialize)]
struct LoadRequest {
    model_path: String,
}

#[derive(Deserialize)]
struct ChatRequest {
    system: String,
    user: String,
    max_tokens: Option<u32>,
    temperature: Option<f32>,
    stop: Option<Vec<String>>,
    response_prefix: Option<String>,
}

#[derive(Serialize)]
struct StatusResponse {
    loaded: bool,
    model_name: Option<String>,
    model_format: Option<String>,
    backend: String,
    lora_adapter: Option<String>,
}

#[derive(Serialize)]
struct ModelsResponse {
    models: Vec<ModelInfo>,
}

#[derive(Serialize)]
struct ModelInfo {
    name: String,
    path: String,
    format: String,
    size_mb: f64,
}

#[derive(Serialize)]
struct ErrorResponse {
    error: String,
}

fn detect_format(path: &std::path::Path) -> &'static str {
    // MLX packs are directories containing config.json and/or model.safetensors
    if path.is_dir() {
        let has_config = path.join("config.json").exists();
        let has_safetensors = path.join("model.safetensors").exists()
            || path.join("model.safetensors.index.json").exists();
        if has_config || has_safetensors {
            return "mlx";
        }
    }
    "unknown"
}

fn dir_size_mb(path: &std::path::Path) -> f64 {
    if path.is_file() {
        return std::fs::metadata(path).map(|m| m.len() as f64 / 1_048_576.0).unwrap_or(0.0);
    }
    let mut total = 0u64;
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.flatten() {
            // Use std::fs::metadata (follows symlinks) instead of entry.metadata
            // (which does NOT follow symlinks). MLX packs often contain symlinks
            // to the actual model files — without this, size shows as 0.0 MB.
            if let Ok(meta) = std::fs::metadata(entry.path()) {
                if meta.is_file() {
                    total += meta.len();
                }
            }
        }
    }
    total as f64 / 1_048_576.0
}

async fn list_models(State(state): State<AppState>) -> impl IntoResponse {
    let mut models = Vec::new();
    let model_dir = &state.model_dir;

    if model_dir.exists() {
        if let Ok(entries) = std::fs::read_dir(model_dir) {
            for entry in entries.flatten() {
                let path = entry.path();
                let name = entry.file_name().to_string_lossy().to_string();
                let format = detect_format(&path);
                if format == "unknown" {
                    continue;
                }
                models.push(ModelInfo {
                    name: name.clone(),
                    path: path.to_string_lossy().to_string(),
                    format: format.to_string(),
                    size_mb: dir_size_mb(&path),
                });
            }
        }
    }

    Json(ModelsResponse { models })
}

async fn get_status(State(state): State<AppState>) -> impl IntoResponse {
    let loader = state.loader.read().await;
    Json(StatusResponse {
        loaded: loader.is_loaded(),
        model_name: loader.model_name().map(|s| s.to_string()),
        model_format: loader.model_format().map(|s| s.to_string()),
        backend: loader.backend_name().to_string(),
        lora_adapter: loader.lora_adapter().map(|s| s.to_string()),
    })
}

async fn load_model(
    State(state): State<AppState>,
    Json(req): Json<LoadRequest>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorResponse>)> {
    let mut loader = state.loader.write().await;
    match loader.load(&req.model_path).await {
        Ok(()) => Ok(Json(serde_json::json!({
            "status": "loaded",
            "model_path": req.model_path,
            "format": detect_format(std::path::Path::new(&req.model_path)),
        }))),
        Err(e) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: e.to_string(),
            }),
        )),
    }
}

fn find_mlx_packs(dir: &std::path::Path) -> Vec<PathBuf> {
    let mut results = Vec::new();
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                // Check if this directory is an MLX pack
                if detect_format(&path) == "mlx" {
                    results.push(path);
                } else {
                    // Recurse into subdirectories
                    results.extend(find_mlx_packs(&path));
                }
            }
        }
    }
    results
}

async fn auto_load_model(
    State(state): State<AppState>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorResponse>)> {
    let mlx_packs = find_mlx_packs(&state.model_dir);

    // Prefer the bonsai-1.7b-mlx-1bit pack if available
    let model_path = mlx_packs
        .iter()
        .find(|p| {
            p.file_name()
                .map(|n| n.to_string_lossy().contains("bonsai-1.7b-mlx-1bit"))
                .unwrap_or(false)
        })
        .or_else(|| mlx_packs.first());

    let model_path = match model_path {
        Some(p) => p,
        None => return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: format!("No MLX model packs found in {}", state.model_dir.display()),
            }),
        )),
    };

    let mut loader = state.loader.write().await;
    match loader.load(&model_path.to_string_lossy()).await {
        Ok(()) => Ok(Json(serde_json::json!({
            "status": "loaded",
            "model_path": model_path.to_string_lossy(),
            "format": "mlx",
        }))),
        Err(e) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: e.to_string(),
            }),
        )),
    }
}

async fn chat(
    State(state): State<AppState>,
    Json(req): Json<ChatRequest>,
) -> Result<
    Sse<impl futures_util::Stream<Item = Result<Event, std::convert::Infallible>>>,
    (StatusCode, Json<ErrorResponse>),
> {
    let loader = state.loader.read().await;
    if !loader.is_loaded() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "No model loaded. POST /api/load first.".to_string(),
            }),
        ));
    }

    let max_tokens = req.max_tokens.unwrap_or(512);
    let temperature = req.temperature.unwrap_or(0.7);
    let stop = req.stop.unwrap_or_default();
    let response_prefix = req.response_prefix.unwrap_or_default();

    let stream = loader.chat_stream(&req.system, &req.user, max_tokens, temperature, stop, response_prefix);

    let sse_stream = ReceiverStream::new(stream).map(|result| {
        match result {
            Ok(token) => {
                let encoded = serde_json::to_string(&token).unwrap_or_else(|_| "\"\"".to_string());
                Ok(Event::default().data(encoded))
            }
            Err(e) => Ok(Event::default()
                .event("error")
                .data(e.to_string())),
        }
    });

    Ok(Sse::new(sse_stream).keep_alive(
        axum::response::sse::KeepAlive::new()
            .interval(std::time::Duration::from_secs(15))
            .text(""),
    ))
}

async fn unload_model(State(state): State<AppState>) -> impl IntoResponse {
    let mut loader = state.loader.write().await;
    loader.unload().await;
    Json(serde_json::json!({"status": "unloaded"}))
}

/// Load or hot-swap a LoRA adapter.
/// Body: { "adapter_path": "/path/to/adapter/dir" }
async fn load_lora(
    State(state): State<AppState>,
    Json(req): Json<serde_json::Value>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorResponse>)> {
    let adapter_path = req
        .get("adapter_path")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    if adapter_path.is_empty() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                error: "adapter_path required".to_string(),
            }),
        ));
    }
    if !PathBuf::from(adapter_path).exists() {
        return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: format!("adapter directory not found: {}", adapter_path),
            }),
        ));
    }

    let mut loader = state.loader.write().await;
    match loader.load_lora(adapter_path).await {
        Ok(()) => Ok(Json(serde_json::json!({
            "status": "ok",
            "adapter": adapter_path,
        }))),
        Err(e) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: e.to_string(),
            }),
        )),
    }
}

/// Detach the current LoRA adapter (revert to base model).
async fn detach_lora(
    State(state): State<AppState>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorResponse>)> {
    let mut loader = state.loader.write().await;
    match loader.detach_lora().await {
        Ok(()) => Ok(Json(serde_json::json!({
            "status": "ok",
            "adapter": null,
        }))),
        Err(e) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(ErrorResponse {
                error: e.to_string(),
            }),
        )),
    }
}

/// Get the current LoRA adapter status.
async fn lora_status(State(state): State<AppState>) -> impl IntoResponse {
    let loader = state.loader.read().await;
    let adapter = loader.lora_adapter();
    Json(serde_json::json!({
        "status": if adapter.is_some() { "loaded" } else { "none" },
        "adapter": adapter,
    }))
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter("kdoc_ai=info,tower_http=info")
        .init();

    let model_dir = std::env::var("KDOC_MODEL_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            let exe_dir = std::env::current_exe()
                .ok()
                .and_then(|p| p.parent().map(|p| p.to_path_buf()))
                .unwrap_or_else(|| PathBuf::from("."));
            exe_dir.join("../../model")
        });

    tracing::info!("Model directory: {}", model_dir.display());

    let state = AppState {
        loader: Arc::new(RwLock::new(ModelLoader::new())),
        model_dir,
    };

    let app = Router::new()
        .route("/api/status", get(get_status))
        .route("/api/models", get(list_models))
        .route("/api/load", post(load_model))
        .route("/api/auto-load", post(auto_load_model))
        .route("/api/unload", post(unload_model))
        .route("/api/chat", post(chat))
        .route("/api/lora/load", post(load_lora))
        .route("/api/lora/detach", post(detach_lora))
        .route("/api/lora/status", get(lora_status))
        .layer(CorsLayer::permissive())
        .with_state(state);

    let port: u16 = std::env::var("KDOC_AI_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(9942);

    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    tracing::info!("KDoc AI backend listening on http://{}", addr);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
