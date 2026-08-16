import React from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import App from "./App";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("未找到 root 节点");

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// 窗口初始为不可见，前端渲染完成后再通知 Rust 显示，避免白屏一闪
if ("__TAURI_INTERNALS__" in window) {
  // 等首帧稳定后再显示窗口，避免 WebView 首帧未提交导致白闪
  window.setTimeout(() => {
    invoke("show_main_window").catch(() => {
      console.error("show_main_window failed");
    });
  }, 120);
}
