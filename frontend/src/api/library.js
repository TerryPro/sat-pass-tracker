// 卫星库 API 封装：数据源组管理 + 本地卫星库浏览。
// 后端接口见 backend/library.py。
import { httpGet, httpPost } from "./http.js";

// 列出可下载的数据源组及本地缓存状态
export function fetchLibraryMeta() {
  return httpGet("/api/library/meta");
}

// 下载某数据源组文件（同步返回），合并进本地卫星库
export function downloadSource(key) {
  return httpPost("/api/library/download", { key });
}

// 浏览本地卫星库数据（q: 名称/NORAD 搜索；source: 按来源过滤）
export function fetchLibraryEntries(params = {}) {
  return httpGet("/api/library/entries", params);
}

// 库内指定卫星的详情（基础字段 + 从 TLE 解析的轨道根数）
export function fetchLibraryDetail(noradId) {
  return httpGet("/api/library/detail", { norad_id: noradId });
}

// 库内指定卫星的档案信息（SatNOGS + AMSAT 频率；后端缓存，refresh 强制联网）
export function fetchLibraryInfo(noradId, refresh = false) {
  return httpGet("/api/library/info", { norad_id: noradId, refresh: refresh ? "true" : "false" });
}

// 把库内某星加入"已加入"列表
export function activateSatellite(noradId) {
  return httpPost("/api/library/activate", { norad_id: noradId });
}

// 把某星从"已加入"列表移除（内置星不可删）
export function deactivateSatellite(id) {
  return httpPost("/api/library/deactivate", { id });
}
