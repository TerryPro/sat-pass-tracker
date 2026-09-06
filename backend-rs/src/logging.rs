//! 统一日志配置：对应 backend/logging_conf.py。
//!
//! 使用 tracing-subscriber 输出带时间/级别/目标的日志到 stdout。
//! 可通过 RUST_LOG 环境变量覆盖级别（默认 info）。

use tracing_subscriber::EnvFilter;

/// 初始化全局日志（幂等：重复调用只生效一次）。
pub fn setup() {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("info,tower_http=info"));
    let _ = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(true)
        .try_init();
}
