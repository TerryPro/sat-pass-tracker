// Socket 连接模块单元测试：验证连接参数、事件注册与回调分发
import { describe, expect, it, vi } from "vitest";

// 捕获 io() 返回的 socket 上注册的事件处理器，便于触发验证
const { ioMock, handlers } = vi.hoisted(() => {
  const handlers = {};
  const ioMock = vi.fn(() => ({
    on: (ev, fn) => {
      handlers[ev] = fn;
    },
  }));
  return { ioMock, handlers };
});

vi.mock("socket.io-client", () => ({ io: ioMock }));

import { createSocket } from "./socket.js";

describe("createSocket", () => {
  it("使用 websocket + polling 传输并建立连接", () => {
    createSocket(() => {}, () => {});
    expect(ioMock).toHaveBeenCalledWith({
      path: "/socket.io",
      transports: ["websocket", "polling"],
    });
  });

  it("注册 state 事件并在收到站点配置时触发回调", () => {
    const onState = vi.fn();
    const onPosition = vi.fn();
    createSocket(onState, onPosition);
    handlers["state"]({ station: "on80dd", position: { t: "2026-08-22T00:00:00Z", az: 120 } });
    expect(onState).toHaveBeenCalledTimes(1);
    expect(onPosition).not.toHaveBeenCalled();
  });

  it("注册 satellite:position 事件并触发位置回调", () => {
    const onState = vi.fn();
    const onPosition = vi.fn();
    createSocket(onState, onPosition);
    const pos = { t: "2026-08-22T00:00:00Z", az: 90, el: 45, r_km: 400 };
    handlers["satellite:position"](pos);
    expect(onPosition).toHaveBeenCalledWith(pos);
    expect(onState).not.toHaveBeenCalled();
  });
});
