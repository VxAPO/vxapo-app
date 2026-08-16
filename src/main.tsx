import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("未找到 root 节点");

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// 正式版窗口初始为隐藏，页面加载完成后显示，避免 WebView 空窗白屏一闪
if ("__TAURI_INTERNALS__" in window) {
  getCurrentWindow().show();
}
