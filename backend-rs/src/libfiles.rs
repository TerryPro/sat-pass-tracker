//! 卫星数据文件层：对应 backend/lib.py。
//!
//! 从标准数据源下载原始 TLE 文件并留档于磁盘目录；只负责网络 IO + 目录管理，
//! 把 CelesTrak 组文件原样保存为 <data>/satellite_files/<key>.tle，不做结构化持久化，
//! 浏览时再按需解析返回。多组可重复下载，同组更新直接覆盖该组文件。
//! （文件名用 libfiles 以避免与 Rust crate 的 lib.rs 约定冲突。）

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::LazyLock;
use std::time::Duration;

use chrono::{DateTime, Utc};
use serde_json::{Value, json};

use crate::astroconv::iso_utc;
use crate::{provider, store, tle};

const CELESTRAK_TLE_URL: &str = "https://celestrak.org/NORAD/elements/gp.php?GROUP={key}&FORMAT=tle";

/// 数据源组定义（含所属分类）。
#[derive(Clone)]
pub struct Group {
    pub key: &'static str,
    pub label: &'static str,
    pub category: &'static str,
    pub category_label: &'static str,
}

impl Group {
    pub fn url(&self) -> String {
        CELESTRAK_TLE_URL.replace("{key}", self.key)
    }
}

/// 六大分类 -> 各组（与 lib.py 的 CELESTRAK_CATEGORIES 一致）。
static CATEGORIES: &[(&str, &str, &[(&str, &str)])] = &[
    ("special", "特种卫星 (Special-Interest)", &[("stations", "载人空间站")]),
    (
        "weather",
        "气象与地球资源",
        &[
            ("weather", "气象卫星"),
            ("resource", "地球资源卫星"),
            ("sar", "合成孔径雷达 (SAR)"),
            ("dmc", "灾害监测 (DMC)"),
        ],
    ),
    (
        "comm",
        "通信卫星",
        &[
            ("amateur", "业余卫星 (Amateur)"),
            ("satnogs", "SatNOGS"),
            ("oneweb", "OneWeb"),
            ("qianfan", "千帆星座 (Qianfan)"),
            ("geo", "地球静止轨道 (GEO)"),
        ],
    ),
    (
        "nav",
        "导航卫星",
        &[
            ("gnss", "GNSS 全球导航"),
            ("gps-ops", "GPS 在轨"),
            ("galileo", "Galileo 伽利略"),
            ("beidou", "北斗 (BeiDou)"),
            ("glo-ops", "GLONASS 在轨"),
        ],
    ),
    (
        "science",
        "科学卫星",
        &[("science", "空间与地球科学"), ("education", "教育卫星")],
    ),
    ("misc", "其它卫星", &[("cubesat", "立方体卫星 (CubeSats)")]),
];

/// 平铺索引：key -> Group。
static GROUP_MAP: LazyLock<HashMap<&'static str, Group>> = LazyLock::new(|| {
    let mut m = HashMap::new();
    for (ckey, clabel, groups) in CATEGORIES {
        for (gkey, glabel) in *groups {
            m.insert(
                *gkey,
                Group {
                    key: gkey,
                    label: glabel,
                    category: ckey,
                    category_label: clabel,
                },
            );
        }
    }
    m
});

/// 返回分类树：[{key,label,groups:[{key,label,url}]}]。
pub fn list_categories() -> Value {
    let cats: Vec<Value> = CATEGORIES
        .iter()
        .map(|(ckey, clabel, groups)| {
            let gs: Vec<Value> = groups
                .iter()
                .map(|(gkey, glabel)| {
                    json!({
                        "key": gkey,
                        "label": glabel,
                        "url": CELESTRAK_TLE_URL.replace("{key}", gkey),
                    })
                })
                .collect();
            json!({ "key": ckey, "label": clabel, "groups": gs })
        })
        .collect();
    Value::Array(cats)
}

/// 返回所有可用数据源组的定义（平铺，含 category，不含本地文件状态）。
pub fn list_groups() -> Vec<Group> {
    let mut v: Vec<Group> = GROUP_MAP.values().cloned().collect();
    v.sort_by_key(|g| g.key);
    v
}

// ---------------------------------------------------------------
// 目录与原始文件管理
// ---------------------------------------------------------------
fn files_dir() -> PathBuf {
    store::satellite_files_dir()
}

fn group_file_path(key: &str) -> PathBuf {
    files_dir().join(format!("{}.tle", key))
}

/// 解析 CelesTrak 3LE 组文件文本，返回 [{norad_id, name, tle1, tle2}]。
pub fn parse_3le(body: &str) -> Vec<Value> {
    let lines: Vec<&str> = body.lines().collect();
    let mut out = Vec::new();
    let mut i = 0usize;
    while i + 2 < lines.len() {
        let name = lines[i].trim();
        let l1 = lines[i + 1].trim();
        let l2 = lines[i + 2].trim();
        if !(l1.starts_with("1 ") && l2.starts_with("2 ")) {
            i += 1;
            continue;
        }
        let norad_str = l1.get(2..7).unwrap_or("").trim();
        if !norad_str.is_empty() && norad_str.chars().all(|c| c.is_ascii_digit()) {
            if let Ok(nid) = norad_str.parse::<i64>() {
                out.push(json!({
                    "norad_id": nid,
                    "name": if name.is_empty() { norad_str } else { name },
                    "tle1": l1,
                    "tle2": l2,
                }));
            }
        }
        i += 3;
    }
    out
}

fn group_count(body: &str) -> usize {
    parse_3le(body).len()
}

/// 下载指定 CelesTrak 组原始文件并保存到目录（同组覆盖更新）。
pub async fn download_group(key: &str) -> Option<Value> {
    let group = GROUP_MAP.get(key)?.clone();
    let body = match crate::provider::http_get_text(&group.url(), 20).await {
        Ok(b) => b,
        Err(exc) => {
            tracing::warn!("CelesTrak 组 {} 下载失败: {}", key, exc);
            return None;
        }
    };
    let path = group_file_path(key);
    if let Err(exc) = store::atomic_write_text(&path, &body) {
        tracing::warn!("CelesTrak 组 {} 写入失败: {}", key, exc);
        return None;
    }
    Some(json!({
        "key": key,
        "label": group.label,
        "path": path.to_string_lossy(),
        "count": group_count(&body),
        "fetched_at": iso_utc(&Utc::now()),
    }))
}

fn mtime_iso(path: &PathBuf) -> String {
    path.metadata()
        .and_then(|m| m.modified())
        .map(|t| iso_utc(&DateTime::<Utc>::from(t)))
        .unwrap_or_default()
}

/// 列出目录中已下载的组文件（含文件信息与条数）。
pub fn list_downloaded() -> Vec<Value> {
    let dir = files_dir();
    let _ = std::fs::create_dir_all(&dir);
    let mut paths: Vec<PathBuf> = std::fs::read_dir(&dir)
        .map(|rd| {
            rd.filter_map(|e| e.ok())
                .map(|e| e.path())
                .filter(|p| p.extension().and_then(|s| s.to_str()) == Some("tle"))
                .collect()
        })
        .unwrap_or_default();
    paths.sort();
    let mut out = Vec::new();
    for path in paths {
        let key = path.file_stem().unwrap_or_default().to_string_lossy().to_string();
        let label = GROUP_MAP
            .get(key.as_str())
            .map(|g| g.label.to_string())
            .unwrap_or_else(|| key.clone());
        let body = match std::fs::read_to_string(&path) {
            Ok(b) => b,
            Err(_) => continue,
        };
        let count = group_count(&body);
        let size = path.metadata().map(|m| m.len()).unwrap_or(0);
        out.push(json!({
            "key": key,
            "label": label,
            "path": path.to_string_lossy(),
            "count": count,
            "size": size,
            "fetched_at": mtime_iso(&path),
        }));
    }
    out
}

/// 读取并解析指定组文件的卫星数据；无该文件或无法识别时返回 None。
pub fn read_group_entries(key: &str) -> Option<Vec<Value>> {
    let path = group_file_path(key);
    if !path.exists() {
        return None;
    }
    let body = std::fs::read_to_string(&path).ok()?;
    let mut parsed = parse_3le(&body);
    if parsed.is_empty() {
        return None;
    }
    let fetched = mtime_iso(&path);
    for e in &mut parsed {
        e["tle_fetched_at"] = json!(fetched);
        e["source"] = json!(key);
    }
    Some(parsed)
}

/// 合并目录中所有已下载组文件的卫星数据。
pub fn list_all_entries() -> Vec<Value> {
    let mut out = Vec::new();
    for info in list_downloaded() {
        let key = info.get("key").and_then(|v| v.as_str()).unwrap_or("");
        if let Some(entries) = read_group_entries(key) {
            out.extend(entries);
        }
    }
    out
}

/// 在所有已下载组文件中查找指定 NORAD 号的卫星（返回第一条匹配）。
pub fn find_entry_by_norad(norad_id: i64) -> Option<Value> {
    let target = norad_id.to_string();
    for info in list_downloaded() {
        let key = info.get("key").and_then(|v| v.as_str()).unwrap_or("");
        for e in read_group_entries(key).unwrap_or_default() {
            if e.get("norad_id").and_then(|v| v.as_i64()).map(|n| n.to_string()) == Some(target.clone()) {
                return Some(e);
            }
        }
    }
    None
}

/// 获取并缓存卫星档案信息（SatNOGS 基本信息 + AMSAT 频率）；无档案返回 None。
pub async fn get_satellite_info(norad_id: i64, refresh: bool) -> Option<Value> {
    let key = norad_id.to_string();
    let saved = store::load_sat_info().get(&key).cloned();
    if let Some(s) = &saved {
        if !refresh {
            let fetched = s.get("fetched_ts").and_then(|v| v.as_f64()).unwrap_or(0.0);
            if store::now_ts() - fetched < tle::INFO_VALID_SECONDS {
                return Some(serialize_info(s, norad_id));
            }
        }
    }
    let meta = provider::fetch_satellite_info_online(norad_id, 20)
        .await
        .unwrap_or_else(|| json!({}));
    // SatNOGS 未收录（空结果）→ 视为"无档案"，返回 None 且不缓存
    let has_name = meta.get("name").and_then(|v| v.as_str()).map(|s| !s.is_empty()).unwrap_or(false)
        || meta
            .get("names")
            .and_then(|v| v.as_str())
            .map(|s| !s.is_empty())
            .unwrap_or(false);
    if !has_name {
        return None;
    }
    let freqs = store::get_amsat_freq_map().await.get(&key).cloned().unwrap_or_default();
    let g = |k: &str| meta.get(k).cloned().unwrap_or_else(|| json!(""));
    let info = json!({
        "names": g("names"),
        "status": g("status"),
        "launch_date": g("launch_date"),
        "operator": g("operator"),
        "countries": g("countries"),
        "website": g("website"),
        "telemetries": meta.get("telemetries").cloned().unwrap_or_else(|| json!([])),
        "frequencies": freqs,
        "image_url": g("image_url"),
    });
    let fetched_ts = store::now_ts();
    store::save_sat_info(norad_id, &info, fetched_ts);
    let mut with_ts = info.as_object().cloned().unwrap_or_default();
    with_ts.insert("fetched_ts".to_string(), json!(fetched_ts));
    Some(serialize_info(&Value::Object(with_ts), norad_id))
}

fn serialize_info(info: &Value, norad_id: i64) -> Value {
    let g = |k: &str| info.get(k).cloned().unwrap_or_else(|| json!(""));
    let fetched_at = match info.get("fetched_ts").and_then(|v| v.as_f64()) {
        Some(ts) => iso_utc(&DateTime::<Utc>::from(
            std::time::UNIX_EPOCH + Duration::from_secs_f64(ts),
        )),
        None => String::new(),
    };
    json!({
        "norad_id": norad_id,
        "names": g("names"),
        "status": g("status"),
        "launch_date": g("launch_date"),
        "operator": g("operator"),
        "countries": g("countries"),
        "website": g("website"),
        "telemetries": info.get("telemetries").cloned().unwrap_or_else(|| json!([])),
        "frequencies": info.get("frequencies").cloned().unwrap_or_else(|| json!([])),
        "image_url": g("image_url"),
        "fetched_at": fetched_at,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_3le_groups() {
        let body = "SAT A\n1 25544U 98067A   08264.51782528 -.00002182  00000-0 -11606-4 0  2927\n2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.72125391563537\nSAT B\n1 42982U 98067NE  20194.06866787  .00008489  00000-0  72204-4 0  9997\n2 42982  51.6338 155.6245 0002758 166.8841 193.2228 15.70564504154944\n";
        let entries = parse_3le(body);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0]["norad_id"].as_i64().unwrap(), 25544);
        assert_eq!(entries[0]["name"].as_str().unwrap(), "SAT A");
        assert_eq!(entries[1]["norad_id"].as_i64().unwrap(), 42982);
    }

    #[test]
    fn categories_and_groups() {
        let cats = list_categories();
        assert_eq!(cats.as_array().unwrap().len(), 6);
        assert!(GROUP_MAP.contains_key("amateur"));
        assert!(GROUP_MAP.contains_key("stations"));
    }
}
