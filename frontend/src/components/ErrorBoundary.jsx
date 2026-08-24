import React from "react";

// 全局错误边界：任何子组件渲染/生命周期异常时显示错误页，避免整页黑屏
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, message: error && error.message ? error.message : String(error) };
  }

  componentDidCatch(error, info) {
    console.error("[ErrorBoundary]", error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            height: "100vh",
            gap: 12,
            fontFamily: "system-ui, sans-serif",
            background: "#1a1d23",
            color: "#eee",
            padding: 24,
            textAlign: "center",
          }}
        >
          <h2 style={{ margin: 0 }}>页面出错了</h2>
          <p style={{ margin: 0, opacity: 0.75, wordBreak: "break-all" }}>{this.state.message}</p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: "8px 20px",
              borderRadius: 6,
              border: "none",
              background: "#1976d2",
              color: "#fff",
              cursor: "pointer",
              fontSize: 14,
            }}
          >
            重新加载
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
