// trackSlice 状态切片单元测试
import { describe, expect, it } from "vitest";
import reducer, { DEFAULT_PARAMS, setSocketStatus, updateParams } from "./trackSlice.js";

describe("trackSlice", () => {
  it("默认参数包含卫星与基础字段", () => {
    expect(DEFAULT_PARAMS.satellite).toBe("fo29");
    expect(DEFAULT_PARAMS.hours).toBe(48);
    expect(DEFAULT_PARAMS.sample_interval).toBe(60);
  });

  it("updateParams 合并更新且保留未变更字段", () => {
    const s0 = reducer(undefined, { type: "@@init" });
    const s1 = reducer(s0, updateParams({ hours: 72 }));
    expect(s1.params.hours).toBe(72);
    expect(s1.params.satellite).toBe("fo29");
    expect(s1.params.lat).toBeCloseTo(39.9042);
  });

  it("setSocketStatus 记录连接状态", () => {
    const s0 = reducer(undefined, { type: "@@init" });
    expect(s0.socketStatus).toBe("connecting");
    const s1 = reducer(s0, setSocketStatus("connected"));
    expect(s1.socketStatus).toBe("connected");
    const s2 = reducer(s1, setSocketStatus("disconnected"));
    expect(s2.socketStatus).toBe("disconnected");
  });
});
