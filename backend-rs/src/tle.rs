//! TLE 管理：对应 backend/tle.py。
//!
//! 在线获取策略（内存缓存 1h → 本地持久化 12h → 联网更新落盘）、卫星参数解析、
//! TLE 历元/轨道根数解析、名称清理。缓存与来源标记用进程内全局表维护。
//! 每颗卫星的联网更新用 per-NORAD 异步锁串行化，避免并发重复拉取。

use std::collections::HashMap;
use std::sync::{Arc, LazyLock, Mutex};

use chrono::{DateTime, Utc};
use serde_json::{Value, json};

use crate::astro::round;
use crate::astroconv;
use crate::{provider, store};

const TLE_CACHE_TTL: f64 = 3600.0; // 内存缓存 1 小时
const TLE_VALID_SECONDS: f64 = 12.0 * 3600.0; // 持久化有效期 12 小时
pub const INFO_VALID_SECONDS: f64 = 30.0 * 24.0 * 3600.0; // 卫星介绍缓存 30 天

/// 内存 TLE 缓存：norad -> (name, tle1, tle2)。
static TLE_CACHE: LazyLock<Mutex<HashMap<i64, (String, String, String)>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
/// 内存缓存写入时间戳：norad -> ts。
static TLE_FETCHED: LazyLock<Mutex<HashMap<i64, f64>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
/// TLE 来源记录：norad -> online/fallback/cache/builtin。
static TLE_SOURCE: LazyLock<Mutex<HashMap<i64, String>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
/// 每颗卫星的联网更新锁（惰性创建）。
static FETCH_LOCKS: LazyLock<Mutex<HashMap<i64, Arc<tokio::sync::Mutex<()>>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn lock_g<T>(m: &LazyLock<Mutex<T>>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

fn tle_fetch_lock(norad_id: i64) -> Arc<tokio::sync::Mutex<()>> {
    let mut map = lock_g(&FETCH_LOCKS);
    map.entry(norad_id)
        .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())))
        .clone()
}

fn set_cache(norad_id: i64, name: &str, tle1: &str, tle2: &str, ts: f64, source: &str) {
    lock_g(&TLE_CACHE).insert(
        norad_id,
        (name.to_string(), tle1.to_string(), tle2.to_string()),
    );
    lock_g(&TLE_FETCHED).insert(norad_id, ts);
    lock_g(&TLE_SOURCE).insert(norad_id, source.to_string());
}

fn cache_fresh(norad_id: i64, now: f64) -> Option<(String, String, String)> {
    let fetched = lock_g(&TLE_FETCHED).get(&norad_id).copied().unwrap_or(0.0);
    if now - fetched < TLE_CACHE_TTL {
        lock_g(&TLE_CACHE).get(&norad_id).cloned()
    } else {
        None
    }
}

/// 写入内存 TLE 缓存（供手动刷新后同步，避免短时间重复下载）。
pub fn tle_cache_set(norad_id: i64, name: &str, tle1: &str, tle2: &str, fetched_ts: f64, source: &str) {
    set_cache(norad_id, name, tle1, tle2, fetched_ts, source);
}

/// 返回指定卫星 TLE 来源：online / fallback / cache / builtin。
///
/// 内存未命中时回读持久化文件（含重启场景）；旧数据无 source 字段视为 cache。
pub fn tle_source(norad_id: i64) -> String {
    if let Some(s) = lock_g(&TLE_SOURCE).get(&norad_id) {
        return s.clone();
    }
    let saved = store::load_tles().get(&norad_id.to_string()).cloned();
    if let Some(s) = saved {
        let src = s
            .get("source")
            .and_then(|v| v.as_str())
            .unwrap_or("cache")
            .to_string();
        lock_g(&TLE_SOURCE).insert(norad_id, src.clone());
        return src;
    }
    "cache".to_string()
}

/// 清理 TLE 名称行可能带的前导编号（如 "0 NOAA 19" -> "NOAA 19"）。
pub fn clean_sat_name(name: &str) -> String {
    let trimmed = name.trim();
    let mut parts = trimmed.splitn(2, ' ');
    let first = parts.next().unwrap_or("");
    if let Some(rest) = parts.next() {
        if !first.is_empty() && first.chars().all(|c| c.is_ascii_digit()) {
            return rest.to_string();
        }
    }
    trimmed.to_string()
}

/// 从持久化条目取 (name, tle1, tle2)。
fn saved_triple(v: &Value) -> Option<(String, String, String)> {
    Some((
        v.get("name")?.as_str()?.to_string(),
        v.get("tle1")?.as_str()?.to_string(),
        v.get("tle2")?.as_str()?.to_string(),
    ))
}

/// TLE 获取策略：内存缓存(1h) → 本地持久化(12h 有效) → 联网更新并落盘。
///
/// 返回 (name, tle1, tle2)。tle_mode=builtin（离线模式）时跳过主动联网：
/// 直接用本地持久化（不限新鲜度）或内置历史 TLE；仅当两者都无数据才联网兜底。
/// 联网失败且无本地/内置数据时返回 Err。
pub async fn get_tle_cached(norad_id: i64) -> Result<(String, String, String), String> {
    let now = store::now_ts();
    let key = norad_id.to_string();

    // 1) 内存缓存：1 小时内直接复用
    if let Some(t) = cache_fresh(norad_id, now) {
        return Ok(t);
    }

    // 2) 本地持久化：12 小时内有效，直接复用（不联网）
    let saved = store::load_tles().get(&key).cloned();
    if let Some(s) = &saved {
        let fetched = s.get("fetched_ts").and_then(|v| v.as_f64()).unwrap_or(0.0);
        if now - fetched < TLE_VALID_SECONDS {
            if let Some(triple) = saved_triple(s) {
                let src = s
                    .get("source")
                    .and_then(|v| v.as_str())
                    .unwrap_or("cache")
                    .to_string();
                lock_g(&TLE_CACHE).insert(norad_id, triple.clone());
                lock_g(&TLE_FETCHED).insert(norad_id, fetched);
                lock_g(&TLE_SOURCE).insert(norad_id, src);
                return Ok(triple);
            }
        }
    }

    // 3) 获取最新 TLE：per-NORAD 锁串行化联网，双检避免并发重复拉取
    let lock = tle_fetch_lock(norad_id);
    let _guard = lock.lock().await;
    if let Some(t) = cache_fresh(norad_id, now) {
        return Ok(t);
    }

    let tle_mode = store::load_settings()
        .get("tle_mode")
        .and_then(|v| v.as_str())
        .unwrap_or("online")
        .to_string();

    let (name, tle1, tle2, source): (String, String, String, String) = if tle_mode == "builtin" {
        // 离线模式：本地缓存（不限新鲜度）→ 内置历史 TLE → 联网兜底一次
        let saved2 = store::load_tles().get(&key).cloned();
        if let Some(s) = saved2.as_ref().and_then(|v| saved_triple(v)) {
            let src = saved2
                .as_ref()
                .unwrap()
                .get("source")
                .and_then(|v| v.as_str())
                .unwrap_or("cache")
                .to_string();
            (s.0, s.1, s.2, src)
        } else if let Some(b) = provider::get_builtin_tle(norad_id) {
            (b.0, b.1, b.2, "builtin".to_string())
        } else {
            match provider::fetch_latest_tle(norad_id).await {
                None => {
                    return Err(format!(
                        "无法获取卫星 NORAD {} 的有效 TLE（联网失败且无本地/内置数据）",
                        norad_id
                    ))
                }
                Some((n, l1, l2, is_fb)) => (
                    n,
                    l1,
                    l2,
                    if is_fb { "fallback" } else { "online" }.to_string(),
                ),
            }
        }
    } else {
        // 在线模式
        match provider::fetch_latest_tle(norad_id).await {
            None => {
                return Err(format!(
                    "无法获取卫星 NORAD {} 的有效 TLE（联网失败且无本地/内置数据）",
                    norad_id
                ))
            }
            Some((n, l1, l2, is_fb)) => (
                n,
                l1,
                l2,
                if is_fb { "fallback" } else { "online" }.to_string(),
            ),
        }
    };

    set_cache(norad_id, &name, &tle1, &tle2, now, &source);
    store::save_tle(norad_id, &clean_sat_name(&name), &tle1, &tle2, now, &source);
    Ok((name, tle1, tle2))
}

/// 解析卫星参数，返回 (id, norad_id)。
///
/// 支持内置 key（iss/css）或任意 NORAD 目录号；未知则回退到 ISS。
pub fn resolve_satellite(params: &Value) -> (String, i64) {
    let sat = params
        .get("satellite")
        .and_then(|v| v.as_str())
        .unwrap_or("iss")
        .to_lowercase();
    let sats = store::load_satellites();
    for s in &sats {
        let sid = s.get("id").and_then(|v| v.as_str()).unwrap_or("");
        let nid = s.get("norad_id").and_then(|v| v.as_i64()).unwrap_or(0);
        if sid == sat || nid.to_string() == sat {
            return (sid.to_string(), nid);
        }
    }
    if let Ok(nid) = sat.parse::<i64>() {
        for s in &sats {
            let sid = s.get("id").and_then(|v| v.as_str()).unwrap_or("");
            let snid = s.get("norad_id").and_then(|v| v.as_i64()).unwrap_or(0);
            if snid == nid {
                return (sid.to_string(), nid);
            }
        }
    }
    ("iss".to_string(), 25544)
}

/// 从 TLE 第一行历元字段解析为 UTC datetime。
pub fn parse_tle_epoch(tle1: &str) -> Option<DateTime<Utc>> {
    astroconv::parse_tle_epoch(tle1)
        .map(|naive| DateTime::<Utc>::from_naive_utc_and_offset(naive, Utc))
}

/// 从 TLE 两行解析轨道根数 + 推算国际编号/轨道分类/近远地点高度；失败返回空对象。
pub fn parse_tle_fields(tle1: &str, tle2: &str) -> Value {
    let compute = || -> Option<Value> {
        let epoch_dt = parse_tle_epoch(tle1);
        let mean_motion: f64 = tle2.get(52..63)?.trim().parse().ok()?;
        let period_min = 1440.0 / mean_motion;
        let inclination: f64 = tle2.get(8..16)?.trim().parse().ok()?;
        let eccentricity: f64 = format!("0.{}", tle2.get(26..33)?.trim()).parse().ok()?;
        let raan: f64 = tle2.get(17..25)?.trim().parse().ok()?;
        let arg_perigee: f64 = tle2.get(34..42)?.trim().parse().ok()?;
        let mean_anomaly: f64 = tle2.get(43..51)?.trim().parse().ok()?;

        // 半长轴：由平均运动按开普勒第三定律反算
        let mu = 398600.4418; // 地球引力常数 km³/s²
        let n_rad_s = mean_motion * 2.0 * std::f64::consts::PI / 86400.0;
        let a_km = (mu / (n_rad_s * n_rad_s)).cbrt();
        let r_earth = 6371.0;
        let perigee_km = a_km * (1.0 - eccentricity) - r_earth;
        let apogee_km = a_km * (1.0 + eccentricity) - r_earth;

        // 轨道分类：按周期 + 倾角 + 偏心率
        let orbit_class = if period_min < 128.0 {
            if (95.0..=105.0).contains(&inclination) {
                "SSO（太阳同步轨道）"
            } else {
                "LEO（低地球轨道）"
            }
        } else if period_min < 600.0 {
            "MEO（中地球轨道）"
        } else if (1300.0..=1500.0).contains(&period_min) {
            if inclination > 10.0 {
                "IGSO（倾斜地球同步轨道）"
            } else {
                "GEO（地球静止轨道）"
            }
        } else if eccentricity > 0.2 {
            "HEO（高椭圆轨道）"
        } else {
            "高地球轨道"
        };

        let cospar = if tle1.len() >= 17 {
            tle1.get(8..17).unwrap_or("").trim().to_string()
        } else {
            String::new()
        };

        Some(json!({
            "cospar": cospar,
            "orbit_class": orbit_class,
            "perigee_km": round(perigee_km, 1),
            "apogee_km": round(apogee_km, 1),
            "epoch": epoch_dt.map(|d| astroconv::iso_utc(&d)).unwrap_or_default(),
            "inclination_deg": round(inclination, 4),
            "raan_deg": round(raan, 4),
            "eccentricity": round(eccentricity, 7),
            "arg_perigee_deg": round(arg_perigee, 4),
            "mean_anomaly_deg": round(mean_anomaly, 4),
            "mean_motion_rev_per_day": round(mean_motion, 6),
            "period_min": round(period_min, 4),
        }))
    };
    compute().unwrap_or_else(|| json!({}))
}

#[cfg(test)]
mod tests {
    use super::*;

    const ISS_L1: &str = "1 25544U 98067A   26224.50000000  .00000000  00000-0  00000-0 0  9999";
    const ISS_L2: &str = "2 25544  51.6416  89.5000 0005000  90.0000  270.0000 15.50995500    00";

    #[test]
    fn clean_name_strips_leading_number() {
        assert_eq!(clean_sat_name("0 NOAA 19"), "NOAA 19");
        assert_eq!(clean_sat_name("  ISS (ZARYA) "), "ISS (ZARYA)");
        assert_eq!(clean_sat_name("12345"), "12345");
    }

    #[test]
    fn parse_epoch() {
        let e = parse_tle_epoch(ISS_L1).unwrap();
        assert_eq!(astroconv::iso_utc(&e), "2026-08-12T12:00:00+00:00");
    }

    #[test]
    fn parse_fields_orbit_roots() {
        let f = parse_tle_fields(ISS_L1, ISS_L2);
        assert_eq!(f.get("inclination_deg").and_then(|v| v.as_f64()).unwrap(), 51.6416);
        assert_eq!(f.get("eccentricity").and_then(|v| v.as_f64()).unwrap(), 0.0005);
        assert!(f.get("orbit_class").and_then(|v| v.as_str()).unwrap().contains("LEO"));
        assert!(f.get("perigee_km").is_some());
    }

    #[test]
    fn parse_fields_bad_input_empty() {
        assert_eq!(parse_tle_fields("short", "short"), json!({}));
    }

    #[test]
    fn resolve_satellite_fallback_iss() {
        let (id, nid) = resolve_satellite(&json!({ "satellite": "nonexistent-xyz" }));
        assert_eq!(id, "iss");
        assert_eq!(nid, 25544);
    }
}
