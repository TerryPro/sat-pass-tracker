//! Socket.IO 服务：对应 backend/sio.py。
//!
//! 连接即回发当前站点配置与最新位置；每 2s 广播卫星当前 az/el。
//! 实时广播状态由业务层（passservice）写入 state，本模块只读使用。
//! 位置计算可能触发 TLE 联网，用异步获取 + spawn_blocking 计算，不阻塞事件循环。

use std::time::Duration;

use serde_json::{Value, json};
use socketioxide::SocketIo;
use socketioxide::extract::SocketRef;

use crate::{astro, state, tle};

/// 计算卫星当前 az/el 等（异步）。无站点配置或计算失败返回 None。
async fn current_position() -> Option<Value> {
    let station = state::get_station()?;
    let sat_key = station
        .get("satellite")
        .and_then(|v| v.as_str())
        .unwrap_or("iss")
        .to_string();
    let (_id, norad_id) = tle::resolve_satellite(&json!({ "satellite": sat_key }));
    // TLE 获取失败（如联网失败且无本地数据）时不广播，不打断连接
    let (_name, tle1, tle2) = tle::get_tle_cached(norad_id).await.ok()?;
    let lat = station.get("lat").and_then(|v| v.as_f64())?;
    let lon = station.get("lon").and_then(|v| v.as_f64())?;
    let alt = station.get("alt").and_then(|v| v.as_f64())?;
    tokio::task::spawn_blocking(move || astro::compute_current_position(&tle1, &tle2, lat, lon, alt))
        .await
        .ok()?
}

/// 注册默认命名空间 "/" 的连接处理器：连接即回发 state（站点 + 位置同源快照）。
pub fn register(io: &SocketIo) {
    io.ns("/", async |socket: SocketRef| {
        let station = state::get_station();
        let position = current_position().await;
        let _ = socket.emit("state", &json!({ "station": station, "position": position }));
    });
}

/// 启动每 2s 广播一次卫星当前位置的后台任务（仅当存在客户端连接时）。
pub fn spawn_broadcaster(io: SocketIo) {
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(2)).await;
            if io.sockets().is_empty() {
                continue;
            }
            if let Some(pos) = current_position().await {
                let _ = io.emit("satellite:position", &pos).await;
            }
        }
    });
}
