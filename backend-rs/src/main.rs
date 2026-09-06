//! 卫星过境跟踪 — Rust 后端入口 (axum + socketioxide)。
//!
//! 对应 backend/app.py：组装各功能模块、CORS、健康检查，并把 Socket.IO 层
//! 挂到 `/socket.io`，其余走 REST 路由。与 Python 后端功能完全对等（drop-in）。
//!
//! 启动：
//!   cd backend-rs
//!   cargo run            # 监听 GS_HOST:GS_PORT（默认 0.0.0.0:8765）

mod astro;
mod astroconv;
mod catalog;
mod config;
mod error;
mod libfiles;
mod logging;
mod models;
mod passservice;
mod provider;
mod routes;
mod sio;
mod state;
mod store;
mod tle;

use axum::extract::State;
use axum::http::HeaderValue;
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::{Value, json};
use socketioxide::SocketIo;
use tower_http::cors::{Any, CorsLayer};

use routes::{library, passes, satellites, settings};

/// axum 全局共享状态：持有 Socket.IO 句柄（健康检查用于统计在线客户端数）。
#[derive(Clone)]
pub struct AppState {
    pub io: SocketIo,
}

/// GET /api/health：健康检查（对应 app.py health）。
async fn health(State(app): State<AppState>) -> Json<Value> {
    Json(json!({
        "status": "ok",
        "service": "sat-pass-tracker",
        "version": *config::APP_VERSION,
        "clients": app.io.sockets().len(),
    }))
}

/// 构建 CORS 层：通配符来源时关闭凭据（对齐 config.CORS_ALLOW_CREDENTIALS 语义）。
fn build_cors() -> CorsLayer {
    let origins = &*config::CORS_ORIGINS;
    if origins.iter().any(|o| o == "*") {
        CorsLayer::new()
            .allow_origin(Any)
            .allow_methods(Any)
            .allow_headers(Any)
    } else {
        let list: Vec<HeaderValue> = origins.iter().filter_map(|o| o.parse().ok()).collect();
        CorsLayer::new()
            .allow_origin(list)
            .allow_credentials(true)
            .allow_methods(Any)
            .allow_headers(Any)
    }
}

#[tokio::main]
async fn main() {
    logging::setup();

    // Socket.IO：挂载于 /socket.io（默认命名空间需手动创建）
    let (socket_layer, io) = SocketIo::new_layer();
    sio::register(&io);
    sio::spawn_broadcaster(io.clone());

    let app = Router::new()
        .route("/api/health", get(health))
        .route("/api/settings", get(settings::get_settings).post(settings::save_settings))
        .route("/api/passes", get(passes::passes))
        .route("/api/groundtrack", get(passes::groundtrack))
        .route("/api/satellites", get(satellites::get_satellites))
        .route("/api/satellites/import", post(satellites::import_satellite))
        .route("/api/satellites/delete", post(satellites::delete_satellite))
        .route("/api/satellites/refresh-all", post(satellites::refresh_all_satellites))
        .route("/api/satellites/{sat_id}", get(satellites::satellite_detail))
        .route("/api/satellites/{sat_id}/info", get(satellites::satellite_info))
        .route("/api/satellites/{sat_id}/refresh", post(satellites::refresh_satellite))
        .route("/api/library/meta", get(library::meta))
        .route("/api/library/download", post(library::download))
        .route("/api/library/entries", get(library::entries))
        .route("/api/library/detail", get(library::detail))
        .route("/api/library/info", get(library::info))
        .route("/api/library/activate", post(library::activate))
        .route("/api/library/deactivate", post(library::deactivate))
        // socketioxide 层拦截 /socket.io，其余透传到上面的 REST 路由
        .layer(socket_layer)
        // CORS 置于最外层，对 REST 与 Socket.IO 轮询响应均生效
        .layer(build_cors())
        .with_state(AppState { io });

    let addr = format!("{}:{}", *config::HOST, *config::PORT);
    let listener = tokio::net::TcpListener::bind(&addr)
        .await
        .unwrap_or_else(|e| panic!("绑定 {} 失败: {}", addr, e));
    tracing::info!(
        "Rust 后端 (sat-pass-tracker v{}) 监听 http://{}",
        *config::APP_VERSION,
        addr
    );
    axum::serve(listener, app)
        .await
        .unwrap_or_else(|e| panic!("服务运行失败: {}", e));
}
