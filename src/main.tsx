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
  requestAnimationFrame(() => {
    invoke("show_main_window").catch(() => {
      // 万一命令失败，窗口仍保持不可见会无法操作；这里不再吞掉错误。
      console.error("show_main_window failed");
    });
  });
}
