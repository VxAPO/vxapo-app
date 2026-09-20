// VxAPO App — 设备列表 / 选中设备的全局状态（决策 4 阶段 A）。
//
// 原 useDevices 的逻辑逐字搬入；错误出口（onError）由 hook 在挂载期注入，
// 卸载即摘掉，行为与「hook 内 mountedRef 抑制」等价。
import { create } from "zustand";
import {
  cleanupStaleInstall,
  deviceListsEqual,
  friendlyError,
  isInstalled,
  listDevices,
  listStaleInstalls,
  migrateStaleInstall,
  uninstallDevice,
} from "../lib/api";
import type { Device, MigrationReport, StaleInstall } from "../lib/model";

/** 逐项浅比较，避免轮询无变化时替换数组引用。 */
function staleListsEqual(a: StaleInstall[], b: StaleInstall[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((s, i) => JSON.stringify(s) === JSON.stringify(b[i]));
}

interface DeviceStore {
  devices: Device[];
  staleInstalls: StaleInstall[];
  staleBusy: boolean;
  /** 当前选中设备 guid（null = 无）。 */
  selectedGuid: string | null;
  uninstallTarget: Device | null;
  uninstalling: boolean;
  /** 首次加载尚未结束。 */
  loading: boolean;
  /** 错误出口（hook 挂载期注入；卸载后为 null，等价于原 mountedRef 抑制）。 */
  errorSink: ((msg: string) => void) | null;

  setErrorSink(sink: ((msg: string) => void) | null): void;
  /** 拉列表：`first` 为首次加载（决定 loading 生命周期）。失败经 errorSink 上报，不抛。 */
  load(first: boolean): Promise<void>;
  /** 安装/卸载后的强制刷新。失败经 errorSink 上报，不抛。 */
  refresh(): Promise<void>;
  setSelectedGuid(guid: string | null): void;
  setUninstallTarget(target: Device | null): void;
  /** 迁移旧 GUID 残留；失败向上抛（调用方决定提示）。 */
  migrateStale(
    from: string,
    to: string,
    configFrom?: string | null,
    snapshotFrom?: string | null,
  ): Promise<MigrationReport | null>;
  /** 清理旧 GUID 残留；失败向上抛。 */
  cleanupStale(guid: string): Promise<void>;
  /** 卸载 uninstallTarget；成功回传设备名（调用方据此提示）。 */
  confirmUninstall(): Promise<string | null>;
}

export const useDeviceStore = create<DeviceStore>((set, get) => ({
  devices: [],
  staleInstalls: [],
  staleBusy: false,
  selectedGuid: null,
  uninstallTarget: null,
  uninstalling: false,
  loading: true,
  errorSink: null,

  setErrorSink(sink) {
    set({ errorSink: sink });
  },

  async load(first) {
    if (first) set({ loading: true });
    try {
      const [devRes, staleRes] = await Promise.allSettled([listDevices(), listStaleInstalls()]);
      if (devRes.status === "rejected") throw devRes.reason;
      const ds = devRes.value;
      set((s) => ({ devices: deviceListsEqual(s.devices, ds) ? s.devices : ds }));
      const nextStale = staleRes.status === "fulfilled" ? staleRes.value : [];
      // 内容未变时保留旧数组引用：否则每 5s 都会换一次引用，触发整树重渲染
      set((s) => ({
        staleInstalls: staleListsEqual(s.staleInstalls, nextStale) ? s.staleInstalls : nextStale,
      }));
      set((s) => ({
        selectedGuid:
          s.selectedGuid && ds.some((d) => d.guid === s.selectedGuid && isInstalled(d))
            ? s.selectedGuid
            : (ds.find(isInstalled)?.guid ?? null),
      }));
    } catch (e: unknown) {
      get().errorSink?.(friendlyError(e));
    } finally {
      if (first) set({ loading: false });
    }
  },

  async refresh() {
    try {
      const [ds, stale] = await Promise.all([
        listDevices(),
        listStaleInstalls().catch(() => [] as StaleInstall[]),
      ]);
      set((s) => ({ devices: deviceListsEqual(s.devices, ds) ? s.devices : ds }));
      set({ staleInstalls: stale });
      set((s) => ({
        selectedGuid:
          s.selectedGuid && ds.some((d) => d.guid === s.selectedGuid && isInstalled(d))
            ? s.selectedGuid
            : (ds.find(isInstalled)?.guid ?? null),
      }));
    } catch (e: unknown) {
      get().errorSink?.(friendlyError(e));
    }
  },

  setSelectedGuid(guid) {
    set({ selectedGuid: guid });
  },

  setUninstallTarget(target) {
    set({ uninstallTarget: target });
  },

  async migrateStale(from, to, configFrom, snapshotFrom) {
    set({ staleBusy: true });
    try {
      const report = await migrateStaleInstall(from, to, configFrom, snapshotFrom);
      await get().refresh();
      return report;
    } finally {
      set({ staleBusy: false });
    }
  },

  async cleanupStale(guid) {
    set({ staleBusy: true });
    try {
      await cleanupStaleInstall(guid);
      await get().refresh();
    } finally {
      set({ staleBusy: false });
    }
  },

  async confirmUninstall() {
    const target = get().uninstallTarget;
    if (!target) return null;
    set({ uninstalling: true });
    try {
      await uninstallDevice(target.guid);
      // 成功后：清掉历史错误、立即刷新列表并回退到已有标签
      get().errorSink?.("");
      await get().refresh();
      set({ uninstallTarget: null });
      return target.name;
    } catch (e: unknown) {
      get().errorSink?.(friendlyError(e));
      return null;
    } finally {
      set({ uninstalling: false });
    }
  },
}));
