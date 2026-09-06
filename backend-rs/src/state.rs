//! 应用运行时状态：对应 backend/state.py。
//!
//! 最近一次计算得到的站点配置 + 过境结果，由业务层（passservice）写入，
//! Socket.IO（sio）与健康检查只读。进程内全局共享，用 RwLock 保护。

use std::sync::{RwLock, RwLockReadGuard, RwLockWriteGuard};

use serde_json::Value;

/// 站点配置 + 当前输出（供 Socket.IO 实时位置广播使用）。
#[derive(Default)]
pub struct RuntimeState {
    pub station: Option<Value>,
    pub output: Option<Value>,
    pub current_satellite: Option<String>,
}

static STATE: RwLock<RuntimeState> = RwLock::new(RuntimeState {
    station: None,
    output: None,
    current_satellite: None,
});

fn read() -> RwLockReadGuard<'static, RuntimeState> {
    STATE.read().unwrap_or_else(|e| e.into_inner())
}

fn write() -> RwLockWriteGuard<'static, RuntimeState> {
    STATE.write().unwrap_or_else(|e| e.into_inner())
}

/// 把最近一次计算写入运行时状态（站点配置 + 输出 + 当前卫星，整体原子更新）。
pub fn update_state(station: Value, output: Value, current_satellite: String) {
    let mut s = write();
    s.station = Some(station);
    s.output = Some(output);
    s.current_satellite = Some(current_satellite);
}

/// 当前站点配置快照（无则 None）。
pub fn get_station() -> Option<Value> {
    read().station.clone()
}

/// 当前过境输出快照（无则 None）。
pub fn get_output() -> Option<Value> {
    read().output.clone()
}
