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
