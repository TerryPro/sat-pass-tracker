// 通用 HTTP 客户端：统一处理查询参数编码、JSON 序列化与错误解析。
// api.js 各接口复用它，消除重复的 fetch / 错误处理样板代码。

// 解析响应 JSON；非 2xx 时抛出带后端 error 信息的异常
async function parseJsonOrThrow(resp) {
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(body.error || `HTTP ${resp.status}`);
  }
  return body;
}

// GET 请求：path 为 URL 路径（如 /api/passes），params 为查询参数对象（可选）
export async function httpGet(path, params) {
  let url = path;
  if (params) {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => qs.set(k, v));
    url = `${path}?${qs.toString()}`;
  }
  const resp = await fetch(url, { cache: "no-store" });
  return parseJsonOrThrow(resp);
}

// POST 请求：body 为要 JSON 序列化的请求体（可选，省略则不带请求体）
export async function httpPost(path, body) {
  const resp = await fetch(path, {
    method: "POST",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return parseJsonOrThrow(resp);
}
