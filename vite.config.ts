import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  // Electron 打包后用 file:// 加载 dist，绝对路径(/assets/…)会白屏；
  // 相对 base 对 Tauri 的 tauri:// 协议同样成立（应用无客户端路由）。
  base: "./",
  build: {
    // Tauri 桌面应用与 Web 端拆包策略不同，提高阈值以避开 500KB 警告
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom"],
          motion: ["framer-motion"],
        },
      },
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    // vapo-bench-profile = perf bench 的隔离 Electron profile（内含锁文件，
    // 会崩 vite 的 watch 目标），必须排除
    watch: { ignored: ["**/src-tauri/**", "**/vapo-bench-profile/**"] },
  },
}));
