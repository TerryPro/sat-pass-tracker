//! 持久化层：对应 backend/store.py。
//!
//! 设置 / TLE / 卫星信息缓存的 JSON 文件读写与规范化，与 Python 后端共享同一份
//! backend/config/*.json 文件。写入方式为"读取-合并-整体写回"（支持分字段保存），
//! 所有写文件均通过原子写（同目录临时文件 + rename），避免半写损坏。
//! 文件 IO 为同步小文件操作，读-改-写用进程内互斥锁保护。

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{Map, Value, json};

use crate::catalog::BUILTIN_SATELLITES;
use crate::config;

/// 持久化读-改-写保护锁（对应 Python `_store_lock`）。仅在同步文件操作期间持有。
static STORE_LOCK: Mutex<()> = Mutex::new(());

/// 当前 UNIX 时间戳（秒，f64）。
pub fn now_ts() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs_f64())
        .unwrap_or(0.0)
}

// ---------------------------------------------------------------
// 文件路径
// ---------------------------------------------------------------
fn settings_file() -> PathBuf {
    config::CONFIG_DIR.join("settings.json")
}
fn tles_file() -> PathBuf {
    config::CONFIG_DIR.join("tles.json")
}
fn satinfo_file() -> PathBuf {
    config::CONFIG_DIR.join("satellite_info.json")
}

/// 卫星数据文件目录（下载的原始数据源文件）。
pub fn satellite_files_dir() -> PathBuf {
    config::DATA_DIR.join("satellite_files")
}

// ---------------------------------------------------------------
// 原子写
// ---------------------------------------------------------------
/// 原子写 JSON：先写同目录临时文件，再 rename 覆盖目标。
pub fn atomic_write_json(path: &Path, data: &Value) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = unique_tmp_path(path);
    // 2 空格缩进 + 不转义非 ASCII（对齐 Python json.dump(indent=2, ensure_ascii=False)）
    let text = serde_json::to_string_pretty(data).map_err(std::io::Error::other)?;
    match std::fs::write(&tmp, text) {
        Ok(()) => std::fs::rename(&tmp, path)?,
        Err(e) => {
            let _ = std::fs::remove_file(&tmp);
            return Err(e);
        }
    }
    Ok(())
}

/// 原子写文本（换行用 \n）。
pub fn atomic_write_text(path: &Path, text: &str) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = unique_tmp_path(path);
    match std::fs::write(&tmp, text) {
        Ok(()) => std::fs::rename(&tmp, path)?,
        Err(e) => {
            let _ = std::fs::remove_file(&tmp);
            return Err(e);
        }
    }
    Ok(())
}

fn unique_tmp_path(path: &Path) -> PathBuf {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    let name = format!(
        "{}.{}.{}.tmp",
        path.file_name().unwrap_or_default().to_string_lossy(),
        std::process::id(),
        nanos
    );
    path.with_file_name(name)
}

// ---------------------------------------------------------------
// 内置站点与默认设置
// ---------------------------------------------------------------
fn builtin_stations() -> Vec<Value> {
    vec![
        json!({
            "id": "on80dd",
            "name": "ON80DD",
            "lat": *config::ON80DD_LAT,
            "lon": *config::ON80DD_LON,
            "alt": *config::ON80DD_ALT_M,
            "builtin": true,
        }),
        json!({
            "id": "beijing",
            "name": "北京",
            "lat": *config::DEFAULT_LAT,
            "lon": *config::DEFAULT_LON,
            "alt": *config::DEFAULT_ALT_M,
            "builtin": true,
        }),
    ]
}

fn builtin_satellites_json() -> Vec<Value> {
    BUILTIN_SATELLITES
        .iter()
        .map(|s| {
            json!({ "id": s.id, "name": s.name, "norad_id": s.norad_id, "builtin": true })
        })
        .collect()
}

/// 默认设置（对应 store.DEFAULT_SETTINGS，含全部键）。
pub fn default_settings() -> Value {
    json!({
        "lat": *config::DEFAULT_LAT,
        "lon": *config::DEFAULT_LON,
        "alt": *config::DEFAULT_ALT_M,
        "satellite": "iss",
        "hours": 48,
        "sample_interval": 60,
        "theme": "dark",
        "stations": builtin_stations(),
        "satellites": builtin_satellites_json(),
        "terminator_show_dashed": true,
        "time_display": "utc",
        "orbit_color": "rgba(255,180,70,0.55)",
        "tle_mode": "online",
        "map2d_engine": "ol",
        "map_click_link": false,
        "map_offline": false,
    })
}

/// DEFAULT_SETTINGS 的已知键集合（用于合并时过滤未知键）。
static DEFAULT_KEYS: LazyLock<HashSet<String>> = LazyLock::new(|| {
    default_settings()
        .as_object()
        .map(|m| m.keys().cloned().collect())
        .unwrap_or_default()
});

// ---------------------------------------------------------------
// 规范化
// ---------------------------------------------------------------
/// 规范化站点列表：内置站点始终保留，自定义站点按 id 去重。
pub fn normalize_stations(stations: Option<&Value>) -> Value {
    let mut merged: Vec<Value> = builtin_stations();
    let mut seen: HashSet<String> = merged
        .iter()
        .filter_map(|s| s.get("id").and_then(|v| v.as_str()).map(String::from))
        .collect();
    if let Some(Value::Array(arr)) = stations {
        for s in arr {
            let Some(obj) = s.as_object() else { continue };
            let Some(sid) = obj.get("id").and_then(|v| v.as_str()) else {
                continue;
            };
            if seen.contains(sid) {
                continue;
            }
            let (Some(lat), Some(lon)) = (
                obj.get("lat").and_then(|v| v.as_f64()),
                obj.get("lon").and_then(|v| v.as_f64()),
            ) else {
                continue;
            };
            let alt = obj
                .get("alt")
                .and_then(|v| v.as_f64())
                .unwrap_or(*config::DEFAULT_ALT_M);
            let name = obj
                .get("name")
                .and_then(|v| v.as_str())
                .filter(|n| !n.is_empty())
                .unwrap_or(sid);
            seen.insert(sid.to_string());
            merged.push(json!({
                "id": sid, "name": name, "lat": lat, "lon": lon, "alt": alt, "builtin": false,
            }));
        }
    }
    Value::Array(merged)
}

/// 规范化卫星列表：内置卫星始终保留，自定义卫星按 id / norad_id 去重。
pub fn normalize_satellites(sats: Option<&Value>) -> Value {
    let mut merged: Vec<Value> = builtin_satellites_json();
    let mut seen_ids: HashSet<String> = HashSet::new();
    let mut seen_norads: HashSet<i64> = HashSet::new();
    for s in &merged {
        if let Some(id) = s.get("id").and_then(|v| v.as_str()) {
            seen_ids.insert(id.to_string());
        }
        if let Some(nid) = s.get("norad_id").and_then(|v| v.as_i64()) {
            seen_norads.insert(nid);
        }
    }
    if let Some(Value::Array(arr)) = sats {
        for s in arr {
            let Some(obj) = s.as_object() else { continue };
            let Some(sid) = obj.get("id").and_then(|v| v.as_str()) else {
                continue;
            };
            if seen_ids.contains(sid) {
                continue;
            }
            let Some(nid) = obj.get("norad_id").and_then(|v| v.as_i64()) else {
                continue;
            };
            if seen_norads.contains(&nid) {
                continue;
            }
            let name = obj
                .get("name")
                .and_then(|v| v.as_str())
                .filter(|n| !n.is_empty())
                .unwrap_or(sid);
            seen_ids.insert(sid.to_string());
            seen_norads.insert(nid);
            merged.push(json!({ "id": sid, "name": name, "norad_id": nid, "builtin": false }));
        }
    }
    Value::Array(merged)
}

// ---------------------------------------------------------------
// 设置读写
// ---------------------------------------------------------------
/// 读取持久化设置；文件不存在或损坏时返回默认值。
pub fn load_settings() -> Value {
    let path = settings_file();
    if let Ok(text) = std::fs::read_to_string(&path) {
        if let Ok(Value::Object(data)) = serde_json::from_str::<Value>(&text) {
            let mut merged = default_settings();
            {
                let m = merged.as_object_mut().unwrap();
                for (k, v) in data.iter() {
                    if DEFAULT_KEYS.contains(k) && k != "stations" && k != "satellites" {
                        m.insert(k.clone(), v.clone());
                    }
                }
            }
            merged["stations"] = normalize_stations(data.get("stations"));
            merged["satellites"] = normalize_satellites(data.get("satellites"));
            return merged;
        }
        tracing::warn!("读取设置失败，回退默认值: {:?}", path);
    }
    default_settings()
}

/// 合并并保存设置：仅更新传入的已知字段，未传字段保持当前值（支持分卡保存）。
pub fn save_settings(payload: &Value) -> Value {
    let _guard = STORE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut merged = load_settings();
    if let Some(obj) = payload.as_object() {
        {
            let m = merged.as_object_mut().unwrap();
            for (k, v) in obj.iter() {
                if DEFAULT_KEYS.contains(k) && k != "stations" && k != "satellites" {
                    m.insert(k.clone(), v.clone());
                }
            }
        }
        if obj.contains_key("stations") {
            merged["stations"] = normalize_stations(obj.get("stations"));
        }
        if obj.contains_key("satellites") {
            merged["satellites"] = normalize_satellites(obj.get("satellites"));
        }
    }
    if let Err(e) = atomic_write_json(&settings_file(), &merged) {
        tracing::error!("设置写入失败: {}", e);
    } else {
        tracing::info!("设置已保存: {:?}", settings_file());
    }
    merged
}

/// 读取卫星列表（内置 + 自定义），返回 SatelliteEntry 值数组。
pub fn load_satellites() -> Vec<Value> {
    let s = load_settings();
    s.get("satellites")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default()
}

/// 规范化并保存卫星列表到设置文件，返回规范化后的列表。
pub fn save_satellites(sats: &Value) -> Value {
    let normalized = normalize_satellites(Some(sats));
    let mut payload = Map::new();
    payload.insert("satellites".to_string(), normalized);
    let merged = save_settings(&Value::Object(payload));
    merged
        .get("satellites")
        .cloned()
        .unwrap_or_else(|| Value::Array(vec![]))
}

// ---------------------------------------------------------------
// TLE 持久化
// ---------------------------------------------------------------
/// 读取持久化 TLE：{ norad_id 字符串: { name, tle1, tle2, fetched_ts, source } }。
pub fn load_tles() -> Value {
    let path = tles_file();
    if let Ok(text) = std::fs::read_to_string(&path) {
        if let Ok(v @ Value::Object(_)) = serde_json::from_str::<Value>(&text) {
            return v;
        }
        tracing::warn!("读取 TLE 缓存失败，按空处理: {:?}", path);
    }
    json!({})
}

/// 把最新 TLE 写入持久化文件；source 记录数据来源（online/fallback/cache/builtin）。
pub fn save_tle(norad_id: i64, name: &str, tle1: &str, tle2: &str, fetched_ts: f64, source: &str) {
    let _guard = STORE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut tles = load_tles();
    tles[norad_id.to_string()] = json!({
        "name": name, "tle1": tle1, "tle2": tle2, "fetched_ts": fetched_ts, "source": source,
    });
    if let Err(e) = atomic_write_json(&tles_file(), &tles) {
        tracing::error!("TLE 写入失败: {}", e);
    } else {
        tracing::info!("TLE 已保存: norad={} source={}", norad_id, source);
    }
}

// ---------------------------------------------------------------
// 卫星信息缓存
// ---------------------------------------------------------------
/// 读取卫星介绍/频率缓存：{ norad_id: {...} }。
pub fn load_sat_info() -> Value {
    let path = satinfo_file();
    if let Ok(text) = std::fs::read_to_string(&path) {
        if let Ok(v @ Value::Object(_)) = serde_json::from_str::<Value>(&text) {
            return v;
        }
        tracing::warn!("读取卫星信息缓存失败，按空处理: {:?}", path);
    }
    json!({})
}

/// 写入卫星介绍/频率缓存（读-改-写加锁）。
pub fn save_sat_info(norad_id: i64, info: &Value, fetched_ts: f64) {
    let _guard = STORE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut infos = load_sat_info();
    let mut entry = info.as_object().cloned().unwrap_or_default();
    entry.insert("fetched_ts".to_string(), json!(fetched_ts));
    infos[norad_id.to_string()] = Value::Object(entry);
    if let Err(e) = atomic_write_json(&satinfo_file(), &infos) {
        tracing::error!("卫星信息写入失败: {}", e);
    } else {
        tracing::info!("卫星信息已保存: norad={}", norad_id);
    }
}

// ---------------------------------------------------------------
// AMSAT 频率表内存缓存（24h 过期）
// ---------------------------------------------------------------
const AMSAT_FREQ_TTL: f64 = 24.0 * 3600.0;
static AMSAT_MAP: LazyLock<Mutex<HashMap<String, Vec<Value>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
static AMSAT_FETCHED_AT: Mutex<f64> = Mutex::new(0.0);
/// AMSAT 频率表初始化锁（异步，跨 await 持有）。
static AMSAT_FETCH_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// 返回按 norad_id 分组的 AMSAT 频率表（24h 缓存；联网失败也记录时间戳，TTL 内不重试）。
pub async fn get_amsat_freq_map() -> HashMap<String, Vec<Value>> {
    {
        let fetched = *AMSAT_FETCHED_AT.lock().unwrap_or_else(|e| e.into_inner());
        if now_ts() - fetched < AMSAT_FREQ_TTL {
            return AMSAT_MAP.lock().unwrap_or_else(|e| e.into_inner()).clone();
        }
    }
    let _guard = AMSAT_FETCH_LOCK.lock().await;
    // 双检：等待中的请求拿到锁后复查
    {
        let fetched = *AMSAT_FETCHED_AT.lock().unwrap_or_else(|e| e.into_inner());
        if now_ts() - fetched < AMSAT_FREQ_TTL {
            return AMSAT_MAP.lock().unwrap_or_else(|e| e.into_inner()).clone();
        }
    }
    let rows = crate::provider::fetch_amsat_frequencies_online().await;
    let mut by_norad: HashMap<String, Vec<Value>> = HashMap::new();
    for r in rows {
        let key = r
            .get("norad_id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        by_norad.entry(key).or_default().push(r);
    }
    *AMSAT_MAP.lock().unwrap_or_else(|e| e.into_inner()) = by_norad.clone();
    *AMSAT_FETCHED_AT.lock().unwrap_or_else(|e| e.into_inner()) = now_ts();
    by_norad
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_stations_keeps_builtin_and_dedups() {
        let custom = json!([
            {"id": "beijing", "name": "dup", "lat": 1.0, "lon": 2.0},  // 与内置重复，应忽略
            {"id": "home", "name": "家", "lat": 30.0, "lon": 120.0, "alt": 10.0},
            {"id": "bad"},  // 缺 lat/lon，应忽略
        ]);
        let out = normalize_stations(Some(&custom));
        let arr = out.as_array().unwrap();
        let ids: Vec<&str> = arr.iter().map(|s| s["id"].as_str().unwrap()).collect();
        assert_eq!(ids, vec!["on80dd", "beijing", "home"]);
    }

    #[test]
    fn normalize_satellites_keeps_builtin_and_dedups() {
        let custom = json!([
            {"id": "iss", "name": "dup", "norad_id": 25544},           // id 重复
            {"id": "x", "name": "X", "norad_id": 25544},               // norad 重复
            {"id": "noaa19", "name": "NOAA 19", "norad_id": 33591},
        ]);
        let out = normalize_satellites(Some(&custom));
        let arr = out.as_array().unwrap();
        let norads: Vec<i64> = arr.iter().map(|s| s["norad_id"].as_i64().unwrap()).collect();
        assert!(norads.contains(&33591));
        assert_eq!(norads.iter().filter(|n| **n == 25544).count(), 1);
    }

    #[test]
    fn default_settings_has_all_keys() {
        let d = default_settings();
        for k in ["lat", "lon", "satellite", "theme", "tle_mode", "map_offline"] {
            assert!(d.get(k).is_some(), "缺少默认键 {}", k);
        }
    }
}
