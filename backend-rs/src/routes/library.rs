//! 卫星数据文件管理 REST 路由：对应 backend/library.py。

use std::collections::HashMap;

use axum::Json;
use axum::extract::Query;
use chrono::Utc;
use serde::Deserialize;
use serde_json::{Value, json};

use crate::astroconv::iso_utc;
use crate::error::{ApiError, ApiResult};
use crate::libfiles;
use crate::store;
use crate::tle;

#[derive(Debug, Deserialize)]
pub struct EntriesQuery {
    #[serde(default)]
    pub q: String,
    #[serde(default)]
    pub source: String,
}

#[derive(Debug, Deserialize)]
pub struct DetailQuery {
    pub norad_id: i64,
}

#[derive(Debug, Deserialize)]
pub struct InfoQuery {
    pub norad_id: i64,
    #[serde(default)]
    pub refresh: bool,
}

/// 组定义 + 本地文件状态（对应 library._group_status）。
fn group_status(g: &Value, downloaded: &HashMap<String, Value>) -> Value {
    let key = g.get("key").and_then(|v| v.as_str()).unwrap_or("");
    match downloaded.get(key) {
        Some(local) => json!({
            "key": key,
            "label": g.get("label").cloned().unwrap_or(Value::Null),
            "url": g.get("url").cloned().unwrap_or(Value::Null),
            "downloaded": true,
            "count": local.get("count").cloned().unwrap_or(json!(0)),
            "size": local.get("size").cloned().unwrap_or(json!(0)),
            "fetched_at": local.get("fetched_at").cloned().unwrap_or(Value::Null),
        }),
        None => json!({
            "key": key,
            "label": g.get("label").cloned().unwrap_or(Value::Null),
            "url": g.get("url").cloned().unwrap_or(Value::Null),
            "downloaded": false,
            "count": 0,
            "size": 0,
            "fetched_at": Value::Null,
        }),
    }
}

/// GET /api/library/meta：数据源分类树 + 本地下载状态。
pub async fn meta() -> Json<Value> {
    let downloaded_list = libfiles::list_downloaded();
    let downloaded_map: HashMap<String, Value> = downloaded_list
        .into_iter()
        .filter_map(|d| {
            d.get("key")
                .and_then(|v| v.as_str())
                .map(|k| (k.to_string(), d.clone()))
        })
        .collect();

    let cats_in = libfiles::list_categories();
    let mut categories: Vec<Value> = Vec::new();
    let mut groups_flat: Vec<Value> = Vec::new();
    if let Some(cats) = cats_in.as_array() {
        for cat in cats {
            let mut cat_groups: Vec<Value> = Vec::new();
            if let Some(gs) = cat.get("groups").and_then(|v| v.as_array()) {
                for g in gs {
                    let status = group_status(g, &downloaded_map);
                    groups_flat.push(status.clone());
                    cat_groups.push(status);
                }
            }
            categories.push(json!({
                "key": cat.get("key").cloned().unwrap_or(Value::Null),
                "label": cat.get("label").cloned().unwrap_or(Value::Null),
                "groups": cat_groups,
            }));
        }
    }
    let total: usize = downloaded_map
        .keys()
        .map(|k| libfiles::read_group_entries(k).map(|e| e.len()).unwrap_or(0))
        .sum();
    Json(json!({
        "categories": categories,
        "groups": groups_flat,
        "total_entries": total,
    }))
}

/// POST /api/library/download：下载某 CelesTrak 组原始文件到本地目录。
pub async fn download(Json(payload): Json<Value>) -> ApiResult<Json<Value>> {
    let key = payload
        .get("key")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    match libfiles::download_group(&key).await {
        Some(result) => Ok(Json(result)),
        None => {
            let valid = libfiles::list_groups().iter().any(|g| g.key == key);
            if !valid {
                Err(ApiError::validation(format!("未知的数据源组: {}", key)))
            } else {
                Err(ApiError::not_found(format!(
                    "数据源组下载失败: {}（网络不可达或返回为空）",
                    key
                )))
            }
        }
    }
}

/// GET /api/library/entries：浏览已下载数据源中的卫星（搜索/按来源过滤）。
pub async fn entries(Query(q): Query<EntriesQuery>) -> Json<Value> {
    let mut parsed = if q.source.trim().is_empty() {
        libfiles::list_all_entries()
    } else {
        libfiles::read_group_entries(q.source.trim()).unwrap_or_default()
    };
    let needle = q.q.trim().to_lowercase();
    if !needle.is_empty() {
        let digits = needle.chars().all(|c| c.is_ascii_digit());
        parsed.retain(|e| {
            if digits {
                let nid = e.get("norad_id").and_then(|v| v.as_i64()).map(|n| n.to_string());
                match nid {
                    Some(s) => s == needle || s.contains(&needle),
                    None => false,
                }
            } else {
                e.get("name")
                    .and_then(|v| v.as_str())
                    .map(|n| n.to_lowercase().contains(&needle))
                    .unwrap_or(false)
            }
        });
    }
    parsed.sort_by_key(|e| {
        e.get("name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_lowercase()
    });
    Json(json!({
        "count": parsed.len(),
        "generated_at": iso_utc(&Utc::now()),
        "entries": parsed,
    }))
}

/// GET /api/library/detail：库内指定卫星详情（TLE + 轨道根数）。
pub async fn detail(Query(q): Query<DetailQuery>) -> ApiResult<Json<Value>> {
    let entry = libfiles::find_entry_by_norad(q.norad_id).ok_or_else(|| {
        ApiError::not_found(format!(
            "卫星库中未找到 NORAD {}（请先下载对应的数据源组）",
            q.norad_id
        ))
    })?;
    let tle1 = entry.get("tle1").and_then(|v| v.as_str()).unwrap_or("");
    let tle2 = entry.get("tle2").and_then(|v| v.as_str()).unwrap_or("");
    let orbit = tle::parse_tle_fields(tle1, tle2);
    Ok(Json(json!({
        "norad_id": entry.get("norad_id").cloned().unwrap_or(Value::Null),
        "name": entry.get("name").cloned().unwrap_or(json!("")),
        "source": entry.get("source").cloned().unwrap_or(json!("")),
        "tle1": tle1,
        "tle2": tle2,
        "tle_fetched_at": entry.get("tle_fetched_at").cloned().unwrap_or(json!("")),
        "orbit": orbit,
    })))
}

/// GET /api/library/info：库内指定卫星档案（SatNOGS + AMSAT）。
pub async fn info(Query(q): Query<InfoQuery>) -> Json<Value> {
    match libfiles::get_satellite_info(q.norad_id, q.refresh).await {
        None => Json(json!({ "norad_id": q.norad_id, "found": false })),
        Some(info) => {
            let mut out = json!({ "norad_id": q.norad_id, "found": true });
            if let (Some(o), Some(i)) = (out.as_object_mut(), info.as_object()) {
                for (k, v) in i {
                    o.insert(k.clone(), v.clone());
                }
            }
            Json(out)
        }
    }
}

/// POST /api/library/activate：把库内卫星加入"已加入"列表。
pub async fn activate(Json(payload): Json<Value>) -> ApiResult<Json<Value>> {
    let norad = match payload.get("norad_id") {
        Some(Value::String(s)) => s.trim().to_string(),
        Some(Value::Number(n)) => n.as_i64().map(|i| i.to_string()).unwrap_or_default(),
        _ => String::new(),
    };
    if norad.is_empty() || !norad.chars().all(|c| c.is_ascii_digit()) {
        return Err(ApiError::validation("请输入有效的 NORAD 目录号（纯数字）"));
    }
    let nid: i64 = norad.parse().unwrap_or(0);
    let sats = store::load_satellites();
    if sats
        .iter()
        .any(|s| s.get("norad_id").and_then(|v| v.as_i64()) == Some(nid))
    {
        return Err(ApiError::validation(format!(
            "卫星（NORAD {}）已在已加入列表中",
            nid
        )));
    }
    let entry = libfiles::find_entry_by_norad(nid).ok_or_else(|| {
        ApiError::not_found(format!(
            "卫星库中未找到 NORAD {}（请先下载对应的数据源组）",
            nid
        ))
    })?;
    let name = entry
        .get("name")
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .unwrap_or_else(|| norad.clone());
    let sat = json!({ "id": norad, "name": name, "norad_id": nid, "builtin": false });
    let mut next = sats.clone();
    next.push(sat.clone());
    let saved = store::save_satellites(&Value::Array(next));
    Ok(Json(json!({ "satellites": saved, "satellite": sat })))
}

/// POST /api/library/deactivate：把卫星从"已加入"列表移除（内置不可删除）。
pub async fn deactivate(Json(payload): Json<Value>) -> ApiResult<Json<Value>> {
    let sid = payload
        .get("id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    if sid.is_empty() {
        return Err(ApiError::validation("缺少卫星 id"));
    }
    let sats: Vec<Value> = store::load_satellites()
        .into_iter()
        .filter(|s| {
            let is_target = s.get("id").and_then(|v| v.as_str()) == Some(sid.as_str());
            let builtin = s.get("builtin").and_then(|v| v.as_bool()).unwrap_or(false);
            !(is_target && !builtin)
        })
        .collect();
    let saved = store::save_satellites(&Value::Array(sats));
    Ok(Json(json!({ "satellites": saved })))
}
