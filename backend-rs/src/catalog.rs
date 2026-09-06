//! 内置卫星参考目录：对应 backend/catalog.py。
//!
//! 唯一数据源为 backend/config/satellites.json（与 Python 后端共享）。
//! store（内置列表种子）与 provider（离线兜底 TLE）均从本目录派生。
//! 目录文件缺失或损坏时回退到代码内置的最小默认（仅 ISS/CSS 身份，不含 TLE）。

use std::collections::HashMap;
use std::sync::LazyLock;

use serde::Deserialize;

use crate::config;

/// config/satellites.json 中单个条目的宽松反序列化结构。
#[derive(Debug, Deserialize)]
struct CatalogFileEntry {
    id: Option<String>,
    name: Option<String>,
    norad_id: Option<i64>,
    #[serde(default)]
    builtin: bool,
    fallback: Option<Vec<String>>,
}

/// 已加入列表中的卫星条目（与前端/settings.json 中的结构一致）。
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SatelliteEntry {
    pub id: String,
    pub name: String,
    pub norad_id: i64,
    pub builtin: bool,
}

/// 目录文件缺失/损坏时的最小兜底（仅内置星身份，不含 TLE）。
fn fallback_catalog() -> Vec<CatalogFileEntry> {
    vec![
        CatalogFileEntry {
            id: Some("iss".into()),
            name: Some("国际空间站 ISS".into()),
            norad_id: Some(25544),
            builtin: true,
            fallback: None,
        },
        CatalogFileEntry {
            id: Some("css".into()),
            name: Some("中国空间站 CSS".into()),
            norad_id: Some(48274),
            builtin: true,
            fallback: None,
        },
    ]
}

/// 读取目录 JSON；缺失/损坏/结构异常时回退内置最小默认。
fn load_catalog() -> Vec<CatalogFileEntry> {
    let path = config::CONFIG_DIR.join("satellites.json");
    if let Ok(text) = std::fs::read_to_string(&path) {
        if let Ok(data) = serde_json::from_str::<Vec<CatalogFileEntry>>(&text) {
            let filtered: Vec<CatalogFileEntry> =
                data.into_iter().filter(|s| s.norad_id.is_some()).collect();
            if !filtered.is_empty() {
                return filtered;
            }
        }
        tracing::warn!("卫星目录读取失败，回退内置最小默认: {:?}", path);
    } else {
        tracing::warn!("卫星目录缺失，回退内置最小默认: {:?}", path);
    }
    fallback_catalog()
}

/// 加载后的目录（进程内单次加载）。
static CATALOG: LazyLock<Vec<CatalogFileEntry>> = LazyLock::new(load_catalog);

/// 内置卫星（不可删除）：UI 卫星列表种子。
pub static BUILTIN_SATELLITES: LazyLock<Vec<SatelliteEntry>> = LazyLock::new(|| {
    CATALOG
        .iter()
        .filter(|s| s.builtin && s.id.is_some())
        .map(|s| SatelliteEntry {
            id: s.id.clone().unwrap_or_default(),
            name: s.name.clone().unwrap_or_default(),
            norad_id: s.norad_id.unwrap_or(0),
            builtin: true,
        })
        .collect()
});

/// 离线兜底 TLE 表：norad_id -> (name, (tle_name, tle1, tle2))，供 provider 使用。
pub static FALLBACK_SATELLITES: LazyLock<HashMap<i64, (String, [String; 3])>> =
    LazyLock::new(|| {
        let mut map = HashMap::new();
        for s in CATALOG.iter() {
            if let (Some(nid), Some(fb), Some(name)) = (s.norad_id, &s.fallback, &s.name) {
                if fb.len() == 3 {
                    map.insert(
                        nid,
                        (
                            name.clone(),
                            [fb[0].clone(), fb[1].clone(), fb[2].clone()],
                        ),
                    );
                }
            }
        }
        map
    });

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtin_contains_iss_and_css() {
        let ids: Vec<&str> = BUILTIN_SATELLITES.iter().map(|s| s.id.as_str()).collect();
        assert!(ids.contains(&"iss"), "内置应含 iss: {:?}", ids);
        assert!(ids.contains(&"css"), "内置应含 css: {:?}", ids);
    }

    #[test]
    fn fallback_has_iss_tle() {
        let iss = FALLBACK_SATELLITES.get(&25544).expect("应有 ISS 兜底 TLE");
        assert!(iss.1[1].starts_with("1 "));
        assert!(iss.1[2].starts_with("2 "));
    }
}
