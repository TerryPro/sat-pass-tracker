//! 统一业务异常：对应 backend/exceptions.py + app.py 的全局异常处理器。
//!
//! 路由层直接返回 `Err(ApiError::...)`，由 `IntoResponse` 统一转换为
//! `{"error": <detail>}` 响应与对应状态码，避免每个 handler 手写错误响应。

use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;

/// 业务错误：携带 HTTP 状态码与对外提示信息。
#[derive(Debug, Clone)]
pub struct ApiError {
    pub status: StatusCode,
    pub detail: String,
}

impl ApiError {
    /// 资源不存在（404）。
    pub fn not_found(detail: impl Into<String>) -> Self {
        Self {
            status: StatusCode::NOT_FOUND,
            detail: detail.into(),
        }
    }

    /// 请求参数无效（400）。
    pub fn validation(detail: impl Into<String>) -> Self {
        Self {
            status: StatusCode::BAD_REQUEST,
            detail: detail.into(),
        }
    }

    /// 服务内部错误（500）。
    pub fn service(detail: impl Into<String>) -> Self {
        Self {
            status: StatusCode::INTERNAL_SERVER_ERROR,
            detail: detail.into(),
        }
    }
}

impl std::fmt::Display for ApiError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{} {}", self.status, self.detail)
    }
}

impl std::error::Error for ApiError {}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        (self.status, Json(json!({ "error": self.detail }))).into_response()
    }
}

/// 路由处理器的统一返回类型别名。
pub type ApiResult<T> = Result<T, ApiError>;
