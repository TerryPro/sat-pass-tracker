import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Provider } from "react-redux";
import App from "./App.jsx";
import { store } from "./store.js";
import "./index.css";

// 注：不启用 StrictMode，避免开发模式下组件双挂载导致 Socket.IO 双连接、双次 API 请求
// 主题由 App 内部根据 Redux 设置动态提供（支持亮/暗切换）
createRoot(document.getElementById("root")).render(
  <Provider store={store}>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </Provider>
);
