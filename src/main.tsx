import React from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import App from "./App";
import { I18nProvider } from "./lib/i18n";
import { readLang } from "./lib/api";
import { setLang } from "./lib/i18n/core";

// 启动：从 lang.txt（安装器写入的默认语言）读取并应用。
async function bootstrap() {
  try {
    const lang = await readLang();
    if (lang === "zh" || lang === "en") {
      setLang(lang);
    }
  } catch {
    console.warn("读取默认语言失败，使用内置默认");
  }
  const rootEl = document.getElementById("root");
  if (!rootEl) throw new Error("未找到 root 节点");
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <I18nProvider>
        <App />
      </I18nProvider>
    </React.StrictMode>,
  );
}

void bootstrap();

// 窗口以不可见方式创建，前端页面加载并渲染完成后通知 Rust 显示
if ("__TAURI_INTERNALS__" in window) {
  const show = () =>
    window.setTimeout(() => {
      invoke("show_main_window").catch(() => {
        console.error("show_main_window failed");
      });
    }, 220);
  if (document.readyState === "complete") show();
  else window.addEventListener("load", show, { once: true });
}
