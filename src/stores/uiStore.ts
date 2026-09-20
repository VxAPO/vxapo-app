// VxAPO App — UI 级状态（错误条 / Toast / 对话框开关与导入目标），决策 4 阶段 A 收尾。
//
// 从 App 的本地 state 收敛而来：错误出口与提示出口直接指向本 store，
// 对话框组件自行订阅开关，App 不再逐项透传。
import { create } from "zustand";

interface UiStore {
  /** 顶部错误条文案（空串隐藏）。 */
  loadErr: string;
  /** Toast 文案（空串隐藏，2.5s 后自动清空）。 */
  notice: string;
  settingsOpen: boolean;
  installOpen: boolean;
  importOpen: boolean;
  importDeviceGuid: string | null;
  /** 安装进行中（设备轮询据此暂停）。 */
  installBusy: boolean;

  setLoadErr(msg: string): void;
  /** 弹出 Toast（沿用原 useToast 的 2.5s 自动消失）。 */
  notify(msg: string): void;
  setSettingsOpen(open: boolean): void;
  setInstallOpen(open: boolean): void;
  setImportOpen(open: boolean): void;
  setImportDeviceGuid(guid: string | null): void;
  setInstallBusy(busy: boolean): void;
}

let noticeTimer: number | undefined;

export const useUiStore = create<UiStore>((set) => ({
  loadErr: "",
  notice: "",
  settingsOpen: false,
  installOpen: false,
  importOpen: false,
  importDeviceGuid: null,
  installBusy: false,

  setLoadErr(msg) {
    set({ loadErr: msg });
  },

  notify(msg) {
    set({ notice: msg });
    window.clearTimeout(noticeTimer);
    noticeTimer = window.setTimeout(() => set({ notice: "" }), 2500);
  },

  setSettingsOpen(open) {
    set({ settingsOpen: open });
  },
  setInstallOpen(open) {
    set({ installOpen: open });
  },
  setImportOpen(open) {
    set({ importOpen: open });
  },
  setImportDeviceGuid(guid) {
    set({ importDeviceGuid: guid });
  },
  setInstallBusy(busy) {
    set({ installBusy: busy });
  },
}));
