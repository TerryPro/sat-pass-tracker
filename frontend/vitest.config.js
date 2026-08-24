import { defineConfig } from "vitest/config";

// 前端单元测试配置：chartUtils / slices 均为纯逻辑，node 环境即可
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.js"],
  },
});
