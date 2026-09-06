//! 纯计算层：过境 / 星下点轨迹 / 实时位置（对应 backend/astro.py）。
//!
//! 不含网络 IO / 文件 IO / 业务编排：输入 TLE 与站点参数，输出计算结果。
//! 过境搜索复刻 Python 的"大步粗搜 + 60 次二分"策略，含数据量保护
//! （单过境自动放大采样间隔、累计样本超限报错、轨迹点数超限放大步长）。

use chrono::{DateTime, TimeDelta, Utc};
use serde_json::{Value, json};

use crate::astroconv::{SatModel, iso_utc};
use crate::models::{AzElSample, GroundTrackPoint, Pass};

/// 单次过境最大采样点数（超限自动放大采样间隔）。
pub const MAX_SAMPLES_PER_PASS: i64 = 5000;
/// 单次请求累计采样点上限（超限报错，提示调整参数）。
pub const MAX_TOTAL_SAMPLES: i64 = 150_000;
/// 星下点轨迹最大点数（超限自动放大步长）。
pub const MAX_GROUNDTRACK_POINTS: i64 = 20_000;

/// 四舍五入到 n 位小数（对齐 Python round(x, n)；NaN/Inf 原样返回）。
pub fn round(x: f64, n: u32) -> f64 {
    if !x.is_finite() {
        return x;
    }
    let f = 10f64.powi(n as i32);
    (x * f).round() / f
}

/// 按过境时长与请求间隔计算采样计划 (点数, 实际间隔秒)。
///
/// 请求间隔过密（时长÷间隔 > max_samples）时自动放大间隔，
/// 保证样本均匀覆盖全程且数量不超过上限；常规场景返回原计划。
pub fn sampling_plan(duration_sec: i64, requested_sec: i64, max_samples: i64) -> (i64, i64) {
    let n = std::cmp::max(2, duration_sec / requested_sec);
    if n <= max_samples {
        return (n, requested_sec);
    }
    let step = requested_sec * ((n + max_samples - 1) / max_samples);
    (std::cmp::max(2, duration_sec / step), step)
}

/// 测站仰角（传播失败返回 Err）。
fn elevation(
    sat: &SatModel,
    t: &DateTime<Utc>,
    lat: f64,
    lon: f64,
    alt_m: f64,
) -> Result<f64, String> {
    sat.altaz(t, lat, lon, alt_m)
        .map(|x| x.el)
        .ok_or_else(|| "SGP4 传播失败".to_string())
}

/// 从 t0 起找下一个仰角上升穿越 horizon 的时刻（10 分钟粗搜 + 二分）。
fn find_next_rise(
    sat: &SatModel,
    lat: f64,
    lon: f64,
    alt_m: f64,
    t0: DateTime<Utc>,
    t_end: DateTime<Utc>,
    horizon: f64,
) -> Result<Option<DateTime<Utc>>, String> {
    let step = TimeDelta::minutes(10);
    let span = (t_end - t0).num_seconds();
    let steps = span / 600 + 2;

    let mut prev = t0;
    let mut prev_el = elevation(sat, &prev, lat, lon, alt_m)?;
    let mut pair: Option<(DateTime<Utc>, DateTime<Utc>)> = None;
    for _ in 0..steps {
        let probe = prev + step;
        if probe >= t_end {
            break;
        }
        let probe_el = elevation(sat, &probe, lat, lon, alt_m)?;
        // 上升穿越对：前一时刻地平线下，后一时刻地平线上
        if prev_el < horizon && horizon <= probe_el {
            pair = Some((prev, probe));
            break;
        }
        prev = probe;
        prev_el = probe_el;
    }
    let (mut t_low, mut t_high) = match pair {
        Some(p) => p,
        None => return Ok(None),
    };
    for _ in 0..60 {
        let mid = t_low + (t_high - t_low) / 2;
        let el_mid = elevation(sat, &mid, lat, lon, alt_m)?;
        if el_mid < horizon {
            t_low = mid;
        } else {
            t_high = mid;
        }
    }
    Ok(Some(t_high))
}

/// 从 t0（已在地平线上）起找下一个仰角下降穿越 horizon 的时刻（15 分钟粗搜 + 二分）。
fn find_next_set(
    sat: &SatModel,
    lat: f64,
    lon: f64,
    alt_m: f64,
    t0: DateTime<Utc>,
    t_end: DateTime<Utc>,
    horizon: f64,
) -> Result<Option<DateTime<Utc>>, String> {
    let step = TimeDelta::minutes(15);
    let span = (t_end - t0).num_seconds();
    let steps = span / 900 + 2;

    let mut prev = t0;
    let mut prev_el = elevation(sat, &prev, lat, lon, alt_m)?;
    let mut pair: Option<(DateTime<Utc>, DateTime<Utc>)> = None;
    for _ in 0..steps {
        let probe = prev + step;
        if probe >= t_end {
            break;
        }
        let probe_el = elevation(sat, &probe, lat, lon, alt_m)?;
        // 下降穿越对：前一时刻地平线上，后一时刻地平线下
        if prev_el >= horizon && horizon > probe_el {
            pair = Some((prev, probe));
            break;
        }
        prev = probe;
        prev_el = probe_el;
    }
    let (mut t_low, mut t_high) = match pair {
        Some(p) => p,
        None => return Ok(None),
    };
    for _ in 0..60 {
        let mid = t_low + (t_high - t_low) / 2;
        let el_mid = elevation(sat, &mid, lat, lon, alt_m)?;
        if el_mid >= horizon {
            t_low = mid;
        } else {
            t_high = mid;
        }
    }
    Ok(Some(t_high))
}

/// 计算未来 hours 小时内的所有过境。
pub fn compute_passes(
    tle_name: &str,
    tle1: &str,
    tle2: &str,
    lat: f64,
    lon: f64,
    alt_m: f64,
    hours: i64,
    horizon_deg: f64,
    sample_interval_sec: i64,
) -> Result<Vec<Pass>, String> {
    let sat = SatModel::from_tle(Some(tle_name.to_string()), tle1, tle2)?;

    let now = Utc::now();
    let t_start = now;
    let t_end = now + TimeDelta::hours(hours);

    let mut passes: Vec<Pass> = Vec::new();
    let mut cursor = t_start;
    let mut idx: i64 = 0;
    let mut total_samples: i64 = 0;

    loop {
        // 当前时刻已在地平线上（高轨/静止卫星可能长时间可见）→ 视为进行中过境
        let cur_el = elevation(&sat, &cursor, lat, lon, alt_m)?;
        let t_rise = if cur_el > horizon_deg {
            cursor
        } else {
            match find_next_rise(&sat, lat, lon, alt_m, cursor, t_end, horizon_deg)? {
                Some(t) => t,
                None => break,
            }
        };

        let t_set =
            find_next_set(&sat, lat, lon, alt_m, t_rise, t_end, horizon_deg)?.unwrap_or(t_end);

        let duration = (t_set - t_rise).num_seconds();
        let (n, step_sec) = sampling_plan(duration, sample_interval_sec, MAX_SAMPLES_PER_PASS);

        // 采样时刻：不超过 LOS
        let mut sample_times: Vec<DateTime<Utc>> = (0..n)
            .map(|i| {
                let t = t_rise + TimeDelta::seconds(i * step_sec);
                if t > t_set {
                    t_set
                } else {
                    t
                }
            })
            .collect();
        // 确保 LOS 也采样一次
        if let Some(&last) = sample_times.last() {
            if last < t_set {
                sample_times.push(t_set);
            }
        }

        let mut samples: Vec<AzElSample> = Vec::with_capacity(sample_times.len());
        let mut peak_el = -999.0f64;
        let mut peak_at = t_rise;
        let mut peak_az = 0.0f64;
        let mut aos_az = 0.0f64;
        let mut los_az = 0.0f64;

        for (k, t) in sample_times.iter().enumerate() {
            let topo = sat
                .altaz(t, lat, lon, alt_m)
                .ok_or_else(|| "SGP4 传播失败".to_string())?;
            if k == 0 {
                aos_az = topo.az;
            }
            los_az = topo.az;
            if topo.el > peak_el {
                peak_el = topo.el;
                peak_at = *t;
                peak_az = topo.az;
            }
            samples.push(AzElSample {
                t: iso_utc(t),
                az: round(topo.az, 3),
                el: round(topo.el, 3),
                r_km: round(topo.r_km, 2),
            });
        }

        idx += 1;
        total_samples += samples.len() as i64;
        if total_samples > MAX_TOTAL_SAMPLES {
            return Err(format!(
                "采样数据量过大（累计 {} 点），请增大采样间隔或缩短显示时长",
                total_samples
            ));
        }

        passes.push(Pass {
            index: idx,
            aos: iso_utc(&t_rise),
            los: iso_utc(&t_set),
            duration_sec: duration,
            max_elevation_deg: round(peak_el, 2),
            max_elevation_at: iso_utc(&peak_at),
            aos_az: round(aos_az, 2),
            los_az: round(los_az, 2),
            peak_az: round(peak_az, 2),
            samples,
        });

        // 下次搜索从 LOS + 小偏移开始，避免重复
        cursor = t_set + TimeDelta::seconds(10);
        if cursor >= t_end {
            break;
        }
    }

    Ok(passes)
}

/// 计算当前时刻卫星相对地面站的 az/el/斜距 + 星下点（Socket.IO 实时广播用）。
///
/// 返回 JSON 对象 { t, az, el, r_km, lat, lon, alt_km }；计算失败返回 None。
pub fn compute_current_position(
    tle1: &str,
    tle2: &str,
    lat: f64,
    lon: f64,
    alt_m: f64,
) -> Option<Value> {
    let sat = SatModel::from_tle(Some("FO-29".to_string()), tle1, tle2).ok()?;
    let now = Utc::now();
    let topo = sat.altaz(&now, lat, lon, alt_m)?;
    // NaN 防护：无效 TLE 会产生 NaN，返回 None 而不是污染前端数据
    if topo.az.is_nan() || topo.el.is_nan() || topo.r_km.is_nan() {
        return None;
    }
    let sub = sat.subpoint(&now)?;
    Some(json!({
        "t": iso_utc(&now),
        "az": round(topo.az, 3),
        "el": round(topo.el, 3),
        "r_km": round(topo.r_km, 2),
        "lat": round(sub.lat, 5),
        "lon": round(sub.lon, 5),
        "alt_km": round(sub.alt_km, 3),
    }))
}

/// 计算未来 hours 小时、每 step_sec 秒一个点的星下点轨迹（完整轨道显示用）。
pub fn compute_groundtrack(
    tle_name: &str,
    tle1: &str,
    tle2: &str,
    lat: f64,
    lon: f64,
    alt_m: f64,
    hours: i64,
    step_sec: i64,
) -> Result<Vec<GroundTrackPoint>, String> {
    let sat = SatModel::from_tle(Some(tle_name.to_string()), tle1, tle2)?;
    let now = Utc::now();

    let mut step_sec = step_sec;
    let mut n = std::cmp::max(2, hours * 3600 / step_sec + 1);
    // 数据量保护：点数超上限时自动放大步长
    if n > MAX_GROUNDTRACK_POINTS {
        let ceil_step = (hours * 3600 + MAX_GROUNDTRACK_POINTS - 1) / MAX_GROUNDTRACK_POINTS;
        step_sec = std::cmp::max(step_sec, ceil_step);
        n = std::cmp::max(2, hours * 3600 / step_sec + 1);
    }

    let mut points: Vec<GroundTrackPoint> = Vec::with_capacity(n as usize);
    let mut orbit: i64 = 1;
    let mut prev_lon: Option<f64> = None;

    for i in 0..n {
        let t = now + TimeDelta::seconds(i * step_sec);
        let sub = sat
            .subpoint(&t)
            .ok_or_else(|| "SGP4 传播失败".to_string())?;
        let topo = sat
            .altaz(&t, lat, lon, alt_m)
            .ok_or_else(|| "SGP4 传播失败".to_string())?;
        // 经度从 -180 -> +180（或反向）跳变视为进入下一圈（用未取整经度判断）
        if let Some(pl) = prev_lon {
            if (sub.lon - pl).abs() > 180.0 {
                orbit += 1;
            }
        }
        prev_lon = Some(sub.lon);
        points.push(GroundTrackPoint {
            t: iso_utc(&t),
            lat: round(sub.lat, 5),
            lon: round(sub.lon, 5),
            el: round(topo.el, 3),
            az: round(topo.az, 3),
            r_km: round(topo.r_km, 2),
            orbit,
            alt_km: round(sub.alt_km, 3),
        });
    }
    Ok(points)
}

#[cfg(test)]
mod tests {
    use super::*;

    // 内置 ISS 兜底 TLE（离线、确定性），与 backend/tests/test_passes.py 对齐
    const ISS_L1: &str = "1 25544U 98067A   26224.50000000  .00000000  00000-0  00000-0 0  9999";
    const ISS_L2: &str = "2 25544  51.6416  89.5000 0005000  90.0000  270.0000 15.50995500    00";
    const BJ: (f64, f64, f64) = (39.9042, 116.4074, 44.0);

    #[test]
    fn sampling_plan_normal_and_capped() {
        assert_eq!(sampling_plan(600, 60, MAX_SAMPLES_PER_PASS), (10, 60));
        // 时长 100000s、间隔 1s => n=100000 超限，应放大间隔到 <=5000 点
        let (n, step) = sampling_plan(100_000, 1, MAX_SAMPLES_PER_PASS);
        assert!(n <= MAX_SAMPLES_PER_PASS);
        assert!(step > 1);
    }

    #[test]
    fn round_half_digits() {
        assert_eq!(round(1.23456, 3), 1.235);
        assert_eq!(round(1.2, 2), 1.2);
        assert!(round(f64::NAN, 3).is_nan());
    }

    #[test]
    fn passes_nonempty_and_ordered() {
        let passes = compute_passes("ISS", ISS_L1, ISS_L2, BJ.0, BJ.1, BJ.2, 48, 0.0, 30)
            .expect("过境计算应成功");
        assert!(!passes.is_empty(), "48 小时内应至少有一次 ISS 过境");
        for w in passes.windows(2) {
            assert!(w[0].aos <= w[1].aos, "过境应按 AOS 升序");
            assert!(w[1].aos >= w[0].los, "相邻过境不应重叠");
        }
        for p in &passes {
            assert!(p.duration_sec > 0);
            assert!((0.0..=90.0).contains(&p.max_elevation_deg));
            assert!(p.samples.len() >= 2);
            for s in &p.samples {
                assert!((0.0..=360.0).contains(&s.az));
                assert!((-90.0..=90.0).contains(&s.el));
            }
        }
    }

    #[test]
    fn groundtrack_orbit_increases() {
        let pts = compute_groundtrack("ISS", ISS_L1, ISS_L2, BJ.0, BJ.1, BJ.2, 6, 60)
            .expect("轨迹计算应成功");
        assert!(pts.len() > 10);
        // 6 小时 ISS 约 3~4 圈，orbit 号应增长
        assert!(pts.iter().any(|p| p.orbit > 1), "轨道圈号应随经度跳变增长");
        for p in &pts {
            assert!(p.lat.abs() <= 90.0 && p.lon.abs() <= 180.0);
        }
    }
}
