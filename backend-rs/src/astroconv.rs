//! 天文基础算法与宽松 TLE 解析（对应 astro.py 中依赖 Skyfield 的部分）。
//!
//! 采用官方 Vallado SGP4（sgp4 crate）传播得到 TEME 位置，再自建坐标转换链：
//!   TEME --GMST--> ECEF(PEF) --测站大地坐标--> SEZ(南-东-天顶) --> az/el/斜距
//!   ECEF --WGS84 反算--> 星下点 lat/lon/alt
//!
//! 为什么自建宽松 TLE 解析：sgp4 crate 的 `Elements::from_tle` 严格校验行长(=69)与
//! 校验和，而 Python/skyfield 宽松接受（本项目内置兜底 TLE 就存在行长 70、校验和非法）。
//! 因此这里按列切片自行解析并手动构造 `sgp4::Elements`（字段均为 pub），
//! 再走 crate 的 `Constants::from_elements` 传播，行为与 Python 一致（宽松、物理正确）。
//!
//! 精度取舍（已确认"物理正确即可"）：
//!   - 用 GMST 做 TEME->PEF，忽略章动/极移/赤道均分点改正(~角秒级)与 ΔUT1(<0.9s)。
//!   - 不做大气折射（对齐 Skyfield `.altaz()` 默认无 refraction）。

use chrono::{DateTime, NaiveDate, NaiveDateTime, NaiveTime, Utc};
use sgp4::{Classification, Constants, Elements, MinutesSinceEpoch};

/// WGS84 椭球长半轴 (km)。
const WGS84_A: f64 = 6378.137;
/// WGS84 扁率。
const WGS84_F: f64 = 1.0 / 298.257223563;
/// WGS84 第一偏心率平方 e² = f(2-f)。
const WGS84_E2: f64 = WGS84_F * (2.0 - WGS84_F);

/// 测站视角：方位角(°)/俯仰角(°)/斜距(km)。
#[derive(Debug, Clone, Copy)]
pub struct Topo {
    pub az: f64,
    pub el: f64,
    pub r_km: f64,
}

/// 星下点：纬度(°)/经度(°)/相对 WGS84 椭球高度(km)。
#[derive(Debug, Clone, Copy)]
pub struct Subpoint {
    pub lat: f64,
    pub lon: f64,
    pub alt_km: f64,
}

// ---------------------------------------------------------------
// 宽松 TLE 解析
// ---------------------------------------------------------------

/// 安全取 ASCII 子串：越界返回空串（TLE 均为 ASCII，按字节切片安全）。
fn slice(line: &str, a: usize, b: usize) -> &str {
    line.get(a..b).unwrap_or("")
}

/// 解析 TLE 的"假想小数点"表示（如 "-11606" -> -0.11606，"0005000" -> 0.0005）。
fn parse_decimal_assumed(field: &str) -> Option<f64> {
    let t = field.trim_start_matches(|c: char| c.is_ascii_whitespace());
    if t.is_empty() {
        return None;
    }
    let s = if let Some(rest) = t.strip_prefix('-') {
        format!("-.{}", rest)
    } else if let Some(rest) = t.strip_prefix('+') {
        format!(".{}", rest)
    } else {
        format!(".{}", t)
    };
    s.parse::<f64>().ok()
}

/// 从 TLE 第一行历元字段解析 UTC NaiveDateTime（对应 tle.py `_parse_tle_epoch`）。
pub fn parse_tle_epoch(tle1: &str) -> Option<NaiveDateTime> {
    if tle1.len() < 33 {
        return None;
    }
    let yy: i32 = slice(tle1, 18, 20).trim().parse().ok()?;
    let day: f64 = slice(tle1, 20, 32).trim().parse().ok()?;
    let year = if yy < 57 { 2000 + yy } else { 1900 + yy };

    let seconds = day.fract() * (24.0 * 60.0 * 60.0);
    let mut nsecs = (seconds.fract() * 1e9).round() as u32;
    let mut secs = seconds as u32;
    if nsecs >= 1_000_000_000 {
        nsecs -= 1_000_000_000;
        secs += 1;
    }
    let date = NaiveDate::from_yo_opt(year, day as u32)?;
    let time = NaiveTime::from_num_seconds_from_midnight_opt(secs, nsecs)?;
    Some(date.and_time(time))
}

/// 宽松解析两行 TLE，手动构造 `sgp4::Elements`（绕过校验和/行长校验）。
///
/// 仅提取传播所需字段（历元 / B* / 六根数）；其余字段填默认值，
/// 因为 `Constants::from_elements` 不使用它们。
pub fn parse_tle_elements(name: Option<String>, tle1: &str, tle2: &str) -> Result<Elements, String> {
    let epoch = parse_tle_epoch(tle1).ok_or_else(|| "TLE 历元解析失败".to_string())?;

    // B*（drag term）= 尾数[53..59] × 10^指数[59..61]
    let bstar_mantissa = parse_decimal_assumed(slice(tle1, 53, 59)).unwrap_or(0.0);
    let bstar_exp: i32 = slice(tle1, 59, 61).trim().parse().unwrap_or(0);
    let drag_term = bstar_mantissa * 10f64.powi(bstar_exp);

    let inclination: f64 = slice(tle2, 8, 16)
        .trim()
        .parse()
        .map_err(|_| "倾角解析失败".to_string())?;
    let right_ascension: f64 = slice(tle2, 17, 25)
        .trim()
        .parse()
        .map_err(|_| "升交点赤经解析失败".to_string())?;
    let eccentricity =
        parse_decimal_assumed(slice(tle2, 26, 33)).ok_or_else(|| "偏心率解析失败".to_string())?;
    let argument_of_perigee: f64 = slice(tle2, 34, 42)
        .trim()
        .parse()
        .map_err(|_| "近地点幅角解析失败".to_string())?;
    let mean_anomaly: f64 = slice(tle2, 43, 51)
        .trim()
        .parse()
        .map_err(|_| "平近点角解析失败".to_string())?;
    let mean_motion: f64 = slice(tle2, 52, 63)
        .trim()
        .parse()
        .map_err(|_| "平均运动解析失败".to_string())?;

    // NORAD 号仅用于展示/记录，Constants::from_elements 不使用它；尽力解析，失败填 0。
    let norad_id: u64 = slice(tle1, 2, 7).trim().parse().unwrap_or(0);

    Ok(Elements {
        object_name: name,
        international_designator: None,
        norad_id,
        classification: Classification::Unclassified,
        datetime: epoch,
        mean_motion_dot: 0.0,
        mean_motion_ddot: 0.0,
        drag_term,
        element_set_number: 0,
        inclination,
        right_ascension,
        eccentricity,
        argument_of_perigee,
        mean_anomaly,
        mean_motion,
        revolution_number: 0,
        ephemeris_type: 0,
    })
}

// ---------------------------------------------------------------
// 坐标与时间转换（纯函数）
// ---------------------------------------------------------------

/// 把 UTC 时刻格式化为 Python `datetime.isoformat()` 等价字符串：
/// `YYYY-MM-DDTHH:MM:SS[.ffffff]+00:00`，微秒精度，微秒为 0 时省略小数部分。
/// 与 Skyfield/后端所有时间戳字符串格式对齐（前端 `new Date(...)` 按 +00:00 解析为 UTC）。
pub fn iso_utc(dt: &DateTime<Utc>) -> String {
    // 量化到微秒（对齐 Python datetime 的微秒精度）
    let dt2 = DateTime::from_timestamp_micros(dt.timestamp_micros())
        .unwrap_or(*dt);
    if dt2.timestamp_subsec_nanos() == 0 {
        dt2.format("%Y-%m-%dT%H:%M:%S+00:00").to_string()
    } else {
        dt2.format("%Y-%m-%dT%H:%M:%S%.6f+00:00").to_string()
    }
}

/// UNIX 时间戳（秒）-> Python `datetime.fromtimestamp(ts, tz=utc).isoformat()` 等价字符串。
pub fn ts_to_iso(ts: f64) -> String {
    let dt = DateTime::<Utc>::from(std::time::UNIX_EPOCH + std::time::Duration::from_secs_f64(ts));
    iso_utc(&dt)
}

/// UTC 时刻的儒略日（UT1 ≈ UTC）。
pub fn julian_date(dt: &DateTime<Utc>) -> f64 {
    2440587.5 + (dt.timestamp() as f64 + dt.timestamp_subsec_nanos() as f64 / 1e9) / 86400.0
}

/// 格林尼治平恒星时 GMST (rad)，Vallado 公式，输入 UTC 儒略日。
pub fn gmst_rad(jd: f64) -> f64 {
    let tut = (jd - 2451545.0) / 36525.0;
    let mut deg = 280.46061837
        + 360.98564736629 * (jd - 2451545.0)
        + 0.000387933 * tut * tut
        - tut * tut * tut / 38710000.0;
    deg = deg % 360.0;
    if deg < 0.0 {
        deg += 360.0;
    }
    deg.to_radians()
}

/// TEME -> ECEF(PEF)：绕 Z 轴旋转 GMST。
pub fn teme_to_ecef(teme: [f64; 3], gmst: f64) -> [f64; 3] {
    let (s, c) = gmst.sin_cos();
    [
        c * teme[0] + s * teme[1],
        -s * teme[0] + c * teme[1],
        teme[2],
    ]
}

/// 大地坐标 (lat°, lon°, alt_km) -> ECEF (km)。
pub fn geodetic_to_ecef(lat_deg: f64, lon_deg: f64, alt_km: f64) -> [f64; 3] {
    let lat = lat_deg.to_radians();
    let lon = lon_deg.to_radians();
    let (slat, clat) = lat.sin_cos();
    let (slon, clon) = lon.sin_cos();
    let n = WGS84_A / (1.0 - WGS84_E2 * slat * slat).sqrt();
    [
        (n + alt_km) * clat * clon,
        (n + alt_km) * clat * slon,
        (n * (1.0 - WGS84_E2) + alt_km) * slat,
    ]
}

/// ECEF (km) -> 大地坐标 (lat°, lon°, alt_km)，迭代法（Bowring 初值 + 数次收敛）。
pub fn ecef_to_geodetic(ecef: [f64; 3]) -> Subpoint {
    let [x, y, z] = ecef;
    let lon = y.atan2(x);
    let p = (x * x + y * y).sqrt();
    // 初值
    let mut lat = z.atan2(p * (1.0 - WGS84_E2));
    let mut n = WGS84_A;
    for _ in 0..6 {
        let slat = lat.sin();
        n = WGS84_A / (1.0 - WGS84_E2 * slat * slat).sqrt();
        lat = (z + WGS84_E2 * n * slat).atan2(p);
    }
    // 高度：赤道附近用 p/cos(lat)，极地附近用 |z|/sin(lat) 保证数值稳定
    let clat = lat.cos();
    let alt = if clat.abs() > 1e-6 {
        p / clat - n
    } else {
        z.abs() / lat.sin().abs() - n * (1.0 - WGS84_E2)
    };
    Subpoint {
        lat: lat.to_degrees(),
        lon: lon.to_degrees(),
        alt_km: alt,
    }
}

/// 由卫星 ECEF 与测站大地坐标求测站视角 az/el/斜距（SEZ 坐标系）。
pub fn ecef_to_topo(sat_ecef: [f64; 3], station_lat_deg: f64, station_lon_deg: f64, station_alt_m: f64) -> Topo {
    let sta = geodetic_to_ecef(station_lat_deg, station_lon_deg, station_alt_m / 1000.0);
    let rho = [
        sat_ecef[0] - sta[0],
        sat_ecef[1] - sta[1],
        sat_ecef[2] - sta[2],
    ];
    let lat = station_lat_deg.to_radians();
    let lon = station_lon_deg.to_radians();
    let (slat, clat) = lat.sin_cos();
    let (slon, clon) = lon.sin_cos();
    // SEZ：南-东-天顶
    let s = slat * clon * rho[0] + slat * slon * rho[1] - clat * rho[2];
    let e = -slon * rho[0] + clon * rho[1];
    let z = clat * clon * rho[0] + clat * slon * rho[1] + slat * rho[2];
    let range = (s * s + e * e + z * z).sqrt();
    let el = if range > 0.0 { (z / range).asin() } else { 0.0 };
    // 方位角自北顺时针：az = atan2(E, N)，N = -S
    let mut az = e.atan2(-s).to_degrees();
    az %= 360.0;
    if az < 0.0 {
        az += 360.0;
    }
    Topo {
        az,
        el: el.to_degrees(),
        r_km: range,
    }
}

// ---------------------------------------------------------------
// 卫星传播器封装
// ---------------------------------------------------------------

/// 封装 SGP4 常量与历元，提供按 UTC 时刻求 TEME / az-el / 星下点。
pub struct SatModel {
    constants: Constants,
    epoch: NaiveDateTime,
}

impl SatModel {
    /// 从两行 TLE 构建传播器；解析或初始化失败返回 Err。
    pub fn from_tle(name: Option<String>, tle1: &str, tle2: &str) -> Result<Self, String> {
        let elements = parse_tle_elements(name, tle1, tle2)?;
        let epoch = elements.datetime;
        let constants = Constants::from_elements(&elements).map_err(|e| e.to_string())?;
        Ok(Self { constants, epoch })
    }

    /// TLE 历元（UTC）。
    pub fn epoch_utc(&self) -> DateTime<Utc> {
        DateTime::<Utc>::from_naive_utc_and_offset(self.epoch, Utc)
    }

    /// 目标 UTC 时刻距历元的分钟数。
    fn minutes_since_epoch(&self, dt: &DateTime<Utc>) -> f64 {
        let dt_naive = dt.naive_utc();
        dt_naive
            .signed_duration_since(self.epoch)
            .num_microseconds()
            .unwrap_or(0) as f64
            / 60e6
    }

    /// 求某 UTC 时刻的 TEME 位置 (km)；传播失败或含 NaN 返回 None。
    pub fn teme(&self, dt: &DateTime<Utc>) -> Option<[f64; 3]> {
        let m = self.minutes_since_epoch(dt);
        let pred = self.constants.propagate(MinutesSinceEpoch(m)).ok()?;
        let p = pred.position;
        if p.iter().any(|v| v.is_nan() || v.is_infinite()) {
            return None;
        }
        Some(p)
    }

    /// 某 UTC 时刻测站视角 az/el/斜距；传播失败返回 None。
    pub fn altaz(
        &self,
        dt: &DateTime<Utc>,
        station_lat_deg: f64,
        station_lon_deg: f64,
        station_alt_m: f64,
    ) -> Option<Topo> {
        let teme = self.teme(dt)?;
        let gmst = gmst_rad(julian_date(dt));
        let ecef = teme_to_ecef(teme, gmst);
        Some(ecef_to_topo(ecef, station_lat_deg, station_lon_deg, station_alt_m))
    }

    /// 某 UTC 时刻星下点 lat/lon/alt_km；传播失败返回 None。
    pub fn subpoint(&self, dt: &DateTime<Utc>) -> Option<Subpoint> {
        let teme = self.teme(dt)?;
        let gmst = gmst_rad(julian_date(dt));
        let ecef = teme_to_ecef(teme, gmst);
        Some(ecef_to_geodetic(ecef))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{Datelike, TimeZone, Timelike};

    // 内置 ISS 兜底 TLE（行长 70 / 校验和非法，验证宽松解析可接受）
    const ISS_L1: &str = "1 25544U 98067A   26224.50000000  .00000000  00000-0  00000-0 0  9999";
    const ISS_L2: &str = "2 25544  51.6416  89.5000 0005000  90.0000  270.0000 15.50995500    00";
    // 标准 69 字符、校验和合法的真实 TLE（sgp4 crate 文档样例）
    const REAL_L1: &str = "1 25544U 98067A   08264.51782528 -.00002182  00000-0 -11606-4 0  2927";
    const REAL_L2: &str = "2 25544  51.6416 247.4627 0006703 130.5360 325.0288 15.72125391563537";

    #[test]
    fn parse_epoch_builtin() {
        let e = parse_tle_epoch(ISS_L1).expect("历元应可解析");
        assert_eq!(e.year(), 2026);
        // day-of-year 224, 0.5 day => 12:00:00
        assert_eq!(e.hour(), 12);
    }

    #[test]
    fn parse_elements_lenient_accepts_bad_checksum_and_long_line() {
        // 内置兜底：行长 70 + 校验和非法，宽松解析仍应成功
        let el = parse_tle_elements(Some("ISS".into()), ISS_L1, ISS_L2).expect("应宽松解析成功");
        assert!((el.inclination - 51.6416).abs() < 1e-9);
        assert!((el.eccentricity - 0.0005).abs() < 1e-9);
        assert!((el.mean_motion - 15.509955).abs() < 1e-6);
    }

    #[test]
    fn parse_elements_real_bstar() {
        let el = parse_tle_elements(None, REAL_L1, REAL_L2).unwrap();
        // drag_term = -0.11606e-4（与 sgp4 crate 文档一致）
        assert!((el.drag_term - (-0.11606e-4)).abs() < 1e-12);
        assert!((el.eccentricity - 0.0006703).abs() < 1e-12);
    }

    #[test]
    fn geodetic_roundtrip() {
        let cases = [
            (39.9042, 116.4074, 0.044),
            (-33.8688, 151.2093, 0.1),
            (0.0, 0.0, 0.0),
            (64.1355, -21.8954, 0.05),
        ];
        for (lat, lon, alt) in cases {
            let ecef = geodetic_to_ecef(lat, lon, alt);
            let g = ecef_to_geodetic(ecef);
            assert!((g.lat - lat).abs() < 1e-6, "lat {} vs {}", g.lat, lat);
            assert!((g.lon - lon).abs() < 1e-6, "lon {} vs {}", g.lon, lon);
            assert!((g.alt_km - alt).abs() < 1e-4, "alt {} vs {}", g.alt_km, alt);
        }
    }

    #[test]
    fn gmst_range() {
        let dt = Utc.with_ymd_and_hms(2020, 7, 12, 1, 19, 7).unwrap();
        let g = gmst_rad(julian_date(&dt));
        assert!((0.0..std::f64::consts::TAU).contains(&g));
    }

    #[test]
    fn propagate_builtin_iss_reasonable_altitude() {
        let sat = SatModel::from_tle(Some("ISS".into()), ISS_L1, ISS_L2).expect("构建传播器");
        let dt = sat.epoch_utc(); // 历元时刻
        let sub = sat.subpoint(&dt).expect("星下点");
        // ISS 高度应在 ~400 km 量级（兜底 TLE 偏心/半长轴对应约 400+ km）
        assert!(sub.alt_km > 300.0 && sub.alt_km < 500.0, "alt={}", sub.alt_km);
        assert!(sub.lat.abs() <= 90.0 && sub.lon.abs() <= 180.0);
    }

    #[test]
    fn altaz_self_consistent() {
        let sat = SatModel::from_tle(Some("ISS".into()), ISS_L1, ISS_L2).unwrap();
        let dt = sat.epoch_utc();
        // 把测站放到星下点：仰角应接近 90°，斜距接近星下点高度
        let sub = sat.subpoint(&dt).unwrap();
        let topo = sat.altaz(&dt, sub.lat, sub.lon, 0.0).unwrap();
        assert!(topo.el > 89.0, "星下点仰角应接近天顶, el={}", topo.el);
        assert!((topo.r_km - sub.alt_km).abs() < 1.0, "斜距应≈高度");
    }
}
