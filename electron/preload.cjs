// preload（沙箱化 preload 只支持 CommonJS）：暴露 window.vxapo，
// 与 Tauri invoke 同形的双模桥（invoke/listen）。
const { contextBridge, ipcRenderer } = require("electron");

const ALLOWED_CHANNELS = new Set(["install-progress", "win-max-state"]);

contextBridge.exposeInMainWorld("vxapo", {
  invoke: (cmd, args) => ipcRenderer.invoke(cmd, args ?? {}),
  listen: (channel, cb) => {
    if (!ALLOWED_CHANNELS.has(channel)) return () => {};
    const listener = (_e, payload) => cb(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
