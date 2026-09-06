//! 卫星目录 REST 接口：对应 backend/satellites.py。
//!
//! 列表 / 搜索 / 导入 / 删除 / 详情 / 介绍频率 / 手动刷新。

use axum::Json;
use axum::extract::Path;
use serde_json::{Value, json};

use crate::astroconv::ts_to_iso;
use crate::error::{ApiError, ApiResult};
use crate::libfiles;
use crate::provider;
use crate::store;
use crate::tle;

const TLE_VALID_SECONDS: f64 = 12.0 * 3600.0;

/// 按 id 或 NORAD 目录号查找卫星。
fn find_satellite(sat_id: &str) -> Option<Value> {
    store::load_satellites().into_iter().find(|s| {
        let id_match = s.get("id").and_then(|v| v.as_str()) == Some(sat_id);
        let norad_match = s
            .get("norad_id")
            .and_then(|v| v.as_i64())
            .map(|n| n.to_string())
            .as_deref()
            == Some(sat_id);
        id_match || norad_match
    })
}

/// 从请求体读取 norad_id（兼容字符串与数字），返回其字符串形式。
fn norad_from_payload(payload: &Value) -> String {
    match payload.get("norad_id") {
        Some(Value::String(s)) => s.trim().to_string(),
        Some(Value::Number(n)) => n
            .as_i64()
            .map(|i| i.to_string())
            .unwrap_or_else(|| n.to_string()),
        _ => String::new(),
    }
}

/// 计算 TLE 获取时间戳（无则 None）。
fn fetched_ts_for(norad_id: i64) -> Option<f64> {
    store::load_tles()
        .get(&norad_id.to_string())
        .and_then(|v| v.get("fetched_ts"))
        .and_then(|v| v.as_f64())
}

/// GET /api/satellites：卫星列表（内置 + 自定义），附 TLE 更新时间与轨道历元。
pub async fn get_satellites() -> Json<Value> {
    let sats = store::load_satellites();
    let tles = store::load_tles();
    let out: Vec<Value> = sats
        .iter()
        .map(|s| {
            let mut item = s.clone();
            let norad = s.get("norad_id").and_then(|v| v.as_i64()).unwrap_or(0);
            match tles.get(&norad.to_string()) {
                Some(saved) => {
                    let fetched = saved.get("fetched_ts").and_then(|v| v.as_f64()).unwrap_or(0.0);
                    item["fetched_at"] = json!(ts_to_iso(fetched));
                    let tle1 = saved.get("tle1").and_then(|v| v.as_str()).unwrap_or("");
                    item["epoch"] = json!(
                        tle::parse_tle_epoch(tle1)
                            .map(|d| crate::astroconv::iso_utc(&d))
                            .unwrap_or_default()
                    );
                }
                None => {
                    item["fetched_at"] = json!("");
                    item["epoch"] = json!("");
                }
            }
            item
        })
        .collect();
    Json(json!({ "satellites": out }))
}

/// POST /api/satellites/import：按 NORAD 目录号从网络导入卫星。
pub async fn import_satellite(Json(payload): Json<Value>) -> ApiResult<Json<Value>> {
    let norad = norad_from_payload(&payload);
    if norad.is_empty() || !norad.chars().all(|c| c.is_ascii_digit()) {
        return Err(ApiError::validation("请输入有效的 NORAD 目录号（纯数字）"));
    }
    let nid: i64 = norad.parse().unwrap_or(0);
    let sats = store::load_satellites();
    if sats
        .iter()
        .any(|s| s.get("norad_id").and_then(|v| v.as_i64()) == Some(nid))
    {
        return Err(ApiError::validation(format!("NORAD {} 已在卫星列表中", nid)));
    }
    match provider::fetch_tle_online(nid).await {
        None => Err(ApiError::not_found(format!(
            "未能在网络上找到 NORAD {} 的有效 TLE（请检查目录号）",
            nid
        ))),
        Some((name, _l1, _l2)) => {
            let name = tle::clean_sat_name(&name);
            let sat = json!({ "id": norad, "name": name, "norad_id": nid, "builtin": false });
            let mut next = sats.clone();
            next.push(sat.clone());
            let saved = store::save_satellites(&Value::Array(next));
            Ok(Json(json!({ "satellites": saved, "satellite": sat })))
        }
    }
}

/// POST /api/satellites/delete：删除自定义卫星（内置不可删除）。
pub async fn delete_satellite(Json(payload): Json<Value>) -> Json<Value> {
    let sid = payload
        .get("id")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let sats: Vec<Value> = store::load_satellites()
        .into_iter()
        .filter(|s| {
            let is_target = s.get("id").and_then(|v| v.as_str()) == Some(sid.as_str());
            let builtin = s.get("builtin").and_then(|v| v.as_bool()).unwrap_or(false);
            !(is_target && !builtin)
        })
        .collect();
    let saved = store::save_satellites(&Value::Array(sats));
    Json(json!({ "satellites": saved }))
}

/// GET /api/satellites/{sat_id}：卫星详情 + 最新 TLE + 轨道根数 + 数据时间/过期状态。
pub async fn satellite_detail(Path(sat_id): Path<String>) -> ApiResult<Json<Value>> {
    let sat = find_satellite(&sat_id).ok_or_else(|| ApiError::not_found("卫星不存在"))?;
    let nid = sat.get("norad_id").and_then(|v| v.as_i64()).unwrap_or(0);
    let (tle_name, tle1, tle2) = tle::get_tle_cached(nid)
        .await
        .map_err(|e| {
            tracing::error!("获取 TLE 失败: {}", e);
            ApiError::service("服务器内部错误")
        })?;
    let fetched_ts = fetched_ts_for(nid);
    let now = store::now_ts();
    let orbit = tle::parse_tle_fields(&tle1, &tle2);
    Ok(Json(json!({
        "id": sat.get("id").cloned().unwrap_or(Value::Null),
        "name": sat.get("name").cloned().unwrap_or(Value::Null),
        "norad_id": nid,
        "builtin": sat.get("builtin").cloned().unwrap_or(Value::Null),
        "tle_name": tle_name,
        "tle1": tle1,
        "tle2": tle2,
        "fetched_at": fetched_ts.map(ts_to_iso).unwrap_or_default(),
        "tle_age_hours": fetched_ts.map(|ts| json!((crate::astro::round((now - ts) / 3600.0, 1)))).unwrap_or(Value::Null),
        "tle_stale": fetched_ts.map(|ts| (now - ts) > TLE_VALID_SECONDS).unwrap_or(false),
        "tle_source": tle::tle_source(nid),
        "orbit": orbit,
    })))
}

/// GET /api/satellites/{sat_id}/info：卫星介绍与频率（SatNOGS + AMSAT）。
pub async fn satellite_info(Path(sat_id): Path<String>) -> ApiResult<Json<Value>> {
    let sat = find_satellite(&sat_id).ok_or_else(|| ApiError::not_found("卫星不存在"))?;
    let nid = sat.get("norad_id").and_then(|v| v.as_i64()).unwrap_or(0);
    let mut base = json!({
        "id": sat.get("id").cloned().unwrap_or(Value::Null),
        "name": sat.get("name").cloned().unwrap_or(Value::Null),
        "norad_id": nid,
        "names": "", "status": "", "launch_date": "", "operator": "",
        "countries": "", "website": "", "telemetries": [], "frequencies": [],
        "fetched_at": "",
    });
    if let Some(info) = libfiles::get_satellite_info(nid, false).await {
        if let (Some(b), Some(i)) = (base.as_object_mut(), info.as_object()) {
            for (k, v) in i {
                b.insert(k.clone(), v.clone());
            }
        }
    }
    Ok(Json(base))
}

/// POST /api/satellites/{sat_id}/refresh：强制从网络刷新指定卫星的 TLE。
pub async fn refresh_satellite(Path(sat_id): Path<String>) -> ApiResult<Json<Value>> {
    let sat = find_satellite(&sat_id).ok_or_else(|| ApiError::not_found("卫星不存在"))?;
    let nid = sat.get("norad_id").and_then(|v| v.as_i64()).unwrap_or(0);
    let (tle_name, tle1, tle2) = provider::fetch_tle_online(nid).await.ok_or_else(|| {
        ApiError::validation(format!(
            "在线刷新失败：未获取到 NORAD {} 的有效 TLE（请稍后重试）",
            nid
        ))
    })?;
    let name = tle::clean_sat_name(&tle_name);
    let now = store::now_ts();
    store::save_tle(nid, &name, &tle1, &tle2, now, "online");
    tle::tle_cache_set(nid, &name, &tle1, &tle2, now, "online");
    let orbit = tle::parse_tle_fields(&tle1, &tle2);
    Ok(Json(json!({
        "id": sat.get("id").cloned().unwrap_or(Value::Null),
        "name": name,
        "norad_id": nid,
        "builtin": sat.get("builtin").cloned().unwrap_or(Value::Null),
        "tle_name": name,
        "tle1": tle1,
        "tle2": tle2,
        "fetched_at": ts_to_iso(now),
        "tle_age_hours": 0.0,
        "tle_stale": false,
        "tle_source": "online",
        "orbit": orbit,
    })))
}

/// POST /api/satellites/refresh-all：批量从网络更新全部卫星的 TLE。
pub async fn refresh_all_satellites() -> Json<Value> {
    let sats = store::load_satellites();
    let mut results: Vec<Value> = Vec::new();
    for sat in sats {
        let nid = sat.get("norad_id").and_then(|v| v.as_i64()).unwrap_or(0);
        let id = sat.get("id").cloned().unwrap_or(Value::Null);
        match provider::fetch_tle_online(nid).await {
            None => results.push(json!({
                "id": id, "norad_id": nid, "ok": false, "error": "在线获取 TLE 失败",
            })),
            Some((tle_name, tle1, tle2)) => {
                let name = tle::clean_sat_name(&tle_name);
                let now = store::now_ts();
                store::save_tle(nid, &name, &tle1, &tle2, now, "online");
                tle::tle_cache_set(nid, &name, &tle1, &tle2, now, "online");
                results.push(json!({
                    "id": id, "norad_id": nid, "ok": true, "fetched_at": ts_to_iso(now),
                }));
            }
        }
    }
    let updated = results
        .iter()
        .filter(|r| r.get("ok").and_then(|v| v.as_bool()).unwrap_or(false))
        .count();
    let failed = results.len() - updated;
    Json(json!({ "results": results, "updated": updated, "failed": failed }))
}
