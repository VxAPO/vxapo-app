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
    // Tauri 桌面应用无需像 Web 端那样强制拆包，提高阈值避免 500KB 警告
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
    watch: { ignored: ["**/src-tauri/**"] },
  },
}));
