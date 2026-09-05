// REST 客户端（REST 接口集合 + 通用 HTTP 客户端）。
// Socket.IO 相关（createSocket / 实时事件）见 ./socket.js 与 hooks/useSocket.js。
// 默认参数统一来自 constants（单一来源）
import { DEFAULT_PARAMS } from "../constants.js";
// 通用 HTTP 客户端（GET/POST + 统一错误解析）
import { httpGet, httpPost } from "./http.js";

// 拉取过境数据
export function fetchPasses(params = {}) {
  return httpGet("/api/passes", { ...DEFAULT_PARAMS, ...params });
}

// 拉取星下点完整轨迹（未来 hours 小时，每 stepSec 秒一个点）
export function fetchGroundTrack(params = {}) {
  return httpGet("/api/groundtrack", { ...DEFAULT_PARAMS, ...params });
}

// 读取持久化用户设置（坐标 / 默认卫星 / 时长 / 采样间隔）
export function fetchSettings() {
  return httpGet("/api/settings");
}

// 保存用户设置到后端（JSON 文件持久化）
export function saveSettings(settings) {
  return httpPost("/api/settings", settings);
}

// 查询卫星列表（含 TLE 更新时间 fetched_at 与轨道历元 epoch）
export function fetchSatellites() {
  return httpGet("/api/satellites");
}

// 从网络导入卫星（按 NORAD 目录号，后端验证 TLE 后入库）
export function importSatellite(noradId) {
  return httpPost("/api/satellites/import", { norad_id: noradId });
}

// 删除自定义卫星（内置卫星不可删除）
export function deleteSatellite(id) {
  return httpPost("/api/satellites/delete", { id });
}

// 查询卫星详情（基本信息 + 最新 TLE + 轨道根数）
export function fetchSatelliteDetail(id) {
  return httpGet(`/api/satellites/${encodeURIComponent(id)}`);
}

// 查询卫星介绍与上下行频率（SatNOGS 数据库）
export function fetchSatelliteInfo(id) {
  return httpGet(`/api/satellites/${encodeURIComponent(id)}/info`);
}

// 手动刷新卫星 TLE（从网络更新轨道数据并持久化）
export function refreshSatellite(id) {
  return httpPost(`/api/satellites/${encodeURIComponent(id)}/refresh`);
}

// 批量更新全部卫星的 TLE（返回每颗卫星结果 + 成功/失败计数）
export function refreshAllSatellites() {
  return httpPost("/api/satellites/refresh-all");
}
