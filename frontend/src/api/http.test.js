// 通用 HTTP 客户端单元测试：验证查询参数编码、POST 请求体与统一错误解析
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { httpGet, httpPost } from "./http.js";

// 构造一个最小可用的 Response 桩（仅覆盖本模块用到的成员）
function mockResponse({ ok = true, status = 200, body = {} } = {}) {
  return {
    ok,
    status,
    json: vi.fn().mockResolvedValue(body),
  };
}

beforeEach(() => {
  global.fetch = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("httpGet", () => {
  it("无参数时不追加查询串", async () => {
    global.fetch.mockResolvedValue(mockResponse({ body: { ok: true } }));
    const data = await httpGet("/api/settings");
    expect(global.fetch).toHaveBeenCalledWith("/api/settings", { cache: "no-store" });
    expect(data).toEqual({ ok: true });
  });

  it("带参数时编码为查询串并合并缓存配置", async () => {
    global.fetch.mockResolvedValue(mockResponse({ body: { n: 1 } }));
    await httpGet("/api/passes", { lat: 39.9, hours: 48, name: "FO-29 (JAS-2)" });
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe("/api/passes?lat=39.9&hours=48&name=FO-29+%28JAS-2%29");
    expect(opts).toEqual({ cache: "no-store" });
  });

  it("非 2xx 时抛出后端 error 信息", async () => {
    global.fetch.mockResolvedValue(mockResponse({ ok: false, status: 400, body: { error: "参数无效" } }));
    await expect(httpGet("/api/passes")).rejects.toThrow("参数无效");
  });

  it("非 2xx 且无 error 字段时回退到 HTTP 状态码", async () => {
    global.fetch.mockResolvedValue(mockResponse({ ok: false, status: 500, body: {} }));
    await expect(httpGet("/api/settings")).rejects.toThrow("HTTP 500");
  });
});

describe("httpPost", () => {
  it("带 JSON 请求体并设置 Content-Type", async () => {
    global.fetch.mockResolvedValue(mockResponse({ body: { id: 1 } }));
    const data = await httpPost("/api/settings", { theme: "dark" });
    const [url, opts] = global.fetch.mock.calls[0];
    expect(url).toBe("/api/settings");
    expect(opts.method).toBe("POST");
    expect(opts.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(opts.body)).toEqual({ theme: "dark" });
    expect(data).toEqual({ id: 1 });
  });

  it("无请求体时省略 body 与 Content-Type", async () => {
    global.fetch.mockResolvedValue(mockResponse({ body: { ok: true } }));
    await httpPost("/api/satellites/refresh-all");
    const [, opts] = global.fetch.mock.calls[0];
    expect(opts.method).toBe("POST");
    expect(opts.headers).toBeUndefined();
    expect(opts.body).toBeUndefined();
  });
});
