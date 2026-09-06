//! 网络数据源层：对应 backend/provider.py。
//!
//! 只负责网络 IO 与文本解析，不含计算与持久化；获取失败返回 None / 空值，
//! 由调用方（tle / 路由）决定兜底策略。异步实现（reqwest）。

use std::sync::LazyLock;
use std::time::Duration;

use serde_json::{Value, json};

use crate::catalog::FALLBACK_SATELLITES;

/// 常见浏览器 UA，避免部分数据源（SatNOGS / CelesTrak）拒绝默认 UA。
const BROWSER_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/// AMSAT 业余卫星频率数据库（GitHub 机器可读文件，活跃卫星）。
const AMSAT_FREQ_URL: &str = "https://raw.githubusercontent.com/palewire/amateur-satellite-database/main/data/amsat-active-frequencies.json";

/// 全局 HTTP 客户端（带统一 UA）。
static HTTP: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .user_agent(BROWSER_UA)
        .build()
        .expect("构建 HTTP 客户端失败")
});

/// 返回内置历史 TLE (tle_name, tle1, tle2)；非内置卫星返回 None（不触发网络）。
pub fn get_builtin_tle(norad_id: i64) -> Option<(String, String, String)> {
    FALLBACK_SATELLITES.get(&norad_id).map(|(_name, fb)| {
        (fb[0].clone(), fb[1].clone(), fb[2].clone())
    })
}

/// 按 NORAD ID 生成候选 TLE 源列表（satnogs 优先，celestrak 其次）。
fn tle_sources(norad_id: i64) -> Vec<(&'static str, String)> {
    vec![
        (
            "satnogs",
            format!(
                "https://db.satnogs.org/api/tle/?norad_cat_id={}&format=3le",
                norad_id
            ),
        ),
        (
            "celestrak",
            format!(
                "https://celestrak.org/NORAD/elements/gp.php?CATNR={}&FORMAT=TLE",
                norad_id
            ),
        ),
    ]
}

async fn http_get(url: &str, timeout_secs: u64) -> Result<String, reqwest::Error> {
    HTTP.get(url)
        .header("Accept", "*/*")
        .timeout(Duration::from_secs(timeout_secs))
        .send()
        .await?
        .text()
        .await
}

/// 公开的 HTTP GET（供 libfiles 下载组文件复用），带统一 UA 与超时。
pub async fn http_get_text(url: &str, timeout_secs: u64) -> Result<String, reqwest::Error> {
    http_get(url, timeout_secs).await
}

/// 从 SatNOGS 数据库获取卫星基本信息；不在库中或请求失败返回 None。
pub async fn fetch_satellite_info_online(norad_id: i64, timeout_secs: u64) -> Option<Value> {
    let url = format!(
        "https://db.satnogs.org/api/satellites/?norad_cat_id={}&format=json",
        norad_id
    );
    let body = http_get(&url, timeout_secs).await.ok()?;
    let data: Value = serde_json::from_str(&body).ok()?;
    let arr = data.as_array()?;
    let s = arr.first()?;

    let img = s.get("image").and_then(|v| v.as_str()).unwrap_or("");
    let image_url = if img.is_empty() {
        String::new()
    } else {
        format!("https://db.satnogs.org/media/{}", img)
    };
    let telemetries: Vec<Value> = s
        .get("telemetries")
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .map(|t| t.get("decoder").cloned().unwrap_or(Value::Null))
                .collect()
        })
        .unwrap_or_default();

    let get_str = |k: &str| {
        s.get(k)
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string()
    };
    Some(json!({
        "name": get_str("name"),
        "names": get_str("names"),
        "status": get_str("status"),
        "launch_date": get_str("launched"),
        "operator": get_str("operator"),
        "countries": get_str("countries"),
        "website": get_str("website"),
        "telemetries": telemetries,
        "image": img,
        "image_url": image_url,
    }))
}

/// 从 AMSAT 业余卫星数据库拉取活跃卫星频率列表；失败返回空列表。
pub async fn fetch_amsat_frequencies_online() -> Vec<Value> {
    let body = match http_get(AMSAT_FREQ_URL, 20).await {
        Ok(b) => b,
        Err(_) => return Vec::new(),
    };
    let data: Value = match serde_json::from_str(&body) {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };
    let Some(arr) = data.as_array() else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for s in arr {
        let Some(obj) = s.as_object() else { continue };
        let g = |k: &str| {
            obj.get(k)
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string()
        };
        // norad_id 在源数据中可能是数字或字符串，统一转为字符串
        let norad = match obj.get("norad_id") {
            Some(Value::String(s)) => s.clone(),
            Some(Value::Number(n)) => n.to_string(),
            _ => String::new(),
        };
        out.push(json!({
            "name": g("name"),
            "norad_id": norad,
            "uplink": g("uplink"),
            "downlink": g("downlink"),
            "beacon": g("beacon"),
            "mode": g("mode"),
            "callsign": g("callsign"),
        }));
    }
    out
}

/// 解析 SatNOGS / CelesTrak 返回的单个卫星 3LE/2LE 文本。
///
/// 名称行缺失（2LE）时返回空名称，由调用方按 NORAD 补全。
pub fn parse_single_3le(body: &str) -> Option<(String, String, String)> {
    let lines: Vec<&str> = body.lines().map(|l| l.trim()).filter(|l| !l.is_empty()).collect();
    if lines.len() >= 3 && lines[1].starts_with("1 ") && lines[2].starts_with("2 ") {
        return Some((
            lines[0].to_string(),
            lines[1].to_string(),
            lines[2].to_string(),
        ));
    }
    if lines.len() >= 2 && lines[0].starts_with("1 ") && lines[1].starts_with("2 ") {
        return Some((String::new(), lines[0].to_string(), lines[1].to_string()));
    }
    None
}

/// 仅从在线源获取指定 NORAD ID 的 TLE，失败返回 None（不回落历史 TLE）。
pub async fn fetch_tle_online(norad_id: i64) -> Option<(String, String, String)> {
    for (src_name, url) in tle_sources(norad_id) {
        match http_get(&url, 20).await {
            Ok(body) => {
                if let Some((mut name, l1, l2)) = parse_single_3le(&body) {
                    let norad_str = norad_id.to_string();
                    let id_field = l1.get(2..8).unwrap_or("");
                    if l1.starts_with("1 ") && l2.starts_with("2 ") && id_field.contains(&norad_str)
                    {
                        // 2LE 响应无名称行：按内置配置或 NORAD 号补全
                        if name.is_empty() {
                            name = FALLBACK_SATELLITES
                                .get(&norad_id)
                                .map(|(n, _)| n.clone())
                                .unwrap_or_else(|| norad_str.clone());
                        }
                        tracing::info!("在线获取 TLE 成功: {} ({})", name, norad_id);
                        return Some((name, l1, l2));
                    }
                }
            }
            Err(exc) => tracing::warn!("TLE 源 {} 获取失败: {}", src_name, exc),
        }
    }
    None
}

/// 按优先级从多个在线源获取最新 TLE；失败则返回历史兜底。
///
/// 返回 (name, tle1, tle2, is_fallback)：is_fallback=true 表示在线源全部失败、
/// 实际返回的是内置历史 TLE。仅内置卫星才有历史兜底；非内置卫星在线失败返回 None。
pub async fn fetch_latest_tle(norad_id: i64) -> Option<(String, String, String, bool)> {
    let builtin = FALLBACK_SATELLITES.get(&norad_id);
    if let Some(online) = fetch_tle_online(norad_id).await {
        return Some((online.0, online.1, online.2, false));
    }
    match builtin {
        None => {
            tracing::warn!("在线 TLE 源均失败且无内置历史 TLE: NORAD {}", norad_id);
            None
        }
        Some((_name, fb)) => {
            tracing::warn!("所有在线 TLE 源均失败，使用历史 TLE 回退值: NORAD {}", norad_id);
            Some((fb[0].clone(), fb[1].clone(), fb[2].clone(), true))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_single_3le_with_name() {
        let body = "ISS (ZARYA)\n1 25544U 98067A   08264.51782528 -.00002182  00000-0 -11606-4 0  2927\n2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.72125391563537\n";
        let (name, l1, l2) = parse_single_3le(body).unwrap();
        assert_eq!(name, "ISS (ZARYA)");
        assert!(l1.starts_with("1 ") && l2.starts_with("2 "));
    }

    #[test]
    fn parse_single_3le_without_name() {
        let body = "1 25544U 98067A   08264.51782528 -.00002182  00000-0 -11606-4 0  2927\n2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.72125391563537\n";
        let (name, l1, _l2) = parse_single_3le(body).unwrap();
        assert_eq!(name, "");
        assert!(l1.starts_with("1 "));
    }

    #[test]
    fn parse_single_3le_invalid() {
        assert!(parse_single_3le("garbage\nmore garbage").is_none());
    }

    #[test]
    fn builtin_tle_present() {
        let iss = get_builtin_tle(25544).expect("ISS 应有兜底 TLE");
        assert!(iss.1.starts_with("1 "));
        assert!(get_builtin_tle(99999999).is_none());
    }
}
