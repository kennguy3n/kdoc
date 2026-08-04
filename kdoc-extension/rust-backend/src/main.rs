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
    if path.extension().map(|e| e == "gguf").unwrap_or(false) {
        "gguf"
    } else {
        "unknown"
    }
}

fn dir_size_mb(path: &std::path::Path) -> f64 {
    if path.is_file() {
        return path.metadata().map(|m| m.len() as f64 / 1_048_576.0).unwrap_or(0.0);
    }
    let mut total = 0u64;
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.flatten() {
            if let Ok(meta) = entry.metadata() {
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

fn find_gguf_files(dir: &std::path::Path) -> Vec<PathBuf> {
    let mut results = Vec::new();
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                results.extend(find_gguf_files(&path));
            } else if path.extension().map(|e| e == "gguf").unwrap_or(false) {
                results.push(path);
            }
        }
    }
    results
}

async fn auto_load_model(
    State(state): State<AppState>,
) -> Result<impl IntoResponse, (StatusCode, Json<ErrorResponse>)> {
    let gguf_files = find_gguf_files(&state.model_dir);
    let model_path = match gguf_files.first() {
        Some(p) => p,
        None => return Err((
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                error: format!("No .gguf files found in {}", state.model_dir.display()),
            }),
        )),
    };

    let mut loader = state.loader.write().await;
    match loader.load(&model_path.to_string_lossy()).await {
        Ok(()) => Ok(Json(serde_json::json!({
            "status": "loaded",
            "model_path": model_path.to_string_lossy(),
            "format": "gguf",
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
