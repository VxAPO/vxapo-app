// VxAPO App — 设备列表 / 选中设备的全局状态。
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
import { t } from "../lib/i18n/core";
import { isElevationFailure, pickAutoRepairTargets } from "../lib/staleAuto";
import { useUiStore } from "./uiStore";

/** 逐项浅比较，避免轮询无变化时替换数组引用。 */
function staleListsEqual(a: StaleInstall[], b: StaleInstall[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((s, i) => JSON.stringify(s) === JSON.stringify(b[i]));
}

type DeviceSet = (partial: Partial<DeviceStore> | ((s: DeviceStore) => Partial<DeviceStore>)) => void;

/** 写入设备列表（引用保持）+ selectedGuid 收口：轮询 / 首载 / 刷新三条路径共用。 */
function applyDevices(set: DeviceSet, ds: Device[]) {
  set((s) => ({ devices: deviceListsEqual(s.devices, ds) ? s.devices : ds }));
  set((s) => ({
    selectedGuid:
      s.selectedGuid && ds.some((d) => d.guid === s.selectedGuid && isInstalled(d))
        ? s.selectedGuid
        : (ds.find(isInstalled)?.guid ?? null),
  }));
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
  /** 低频兜底重拉 stale 残留列表（轮询不再每 5s 顺带拉 stale）。 */
  loadStale(): Promise<void>;
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
  /** 迁移残留并自行上报错误（失败返回 null，不抛）——原 App 侧包装回调的等价物。 */
  migrateStaleSafe(
    from: string,
    to: string,
    configFrom?: string | null,
    snapshotFrom?: string | null,
  ): Promise<MigrationReport | null>;
  /** 清理残留并自行上报错误（不抛）——原 App 侧包装回调的等价物。 */
  cleanupStaleSafe(guid: string): Promise<void>;
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
      // 轮询（!first）只拉设备：stale 的变化源是安装/卸载/迁移动作（动作后的
      // refresh() 会同步重拉），每 5s 重拉等于每轮白付一次 CLI 子进程 spawn；
      // 无列表变化的外部漂移由 loadStale 的低频兜底轮询对齐。
      if (!first) {
        const prev = get().devices;
        applyDevices(set, await listDevices());
        // 插拔必须当拍同步 stale：list_stale_installs 按活跃端点分类记录，
        // enumerate_devices 也只收活跃端点——设备列表内容变化即插拔信号。
        // 只靠 60s 兜底会让横幅对着已拔出的端点停一分钟（实测反馈）。
        // 稳态（列表不变）仍是每轮单 spawn，只有变化那一拍多补一次。
        if (get().devices !== prev) void get().loadStale();
        return;
      }
      let [devRes, staleRes] = await Promise.allSettled([listDevices(), listStaleInstalls()]);
      if (devRes.status === "rejected") throw devRes.reason;

      // ── 启动自动修复（横幅降级为兜底）──────────────────────────────────
      // 只在**首次**加载尝试，一次启动最多一次：driver 已判定 auto_repairable
      // （目标唯一命中 + 旧记录配置有意义 + 目标目录没有有意义的配置），
      // 这里逐条执行迁移（提权 CLI；UAC 由用户点一下即可）。
      //
      // **逐条独立**：GUID 迁移是按设备各自触发的，一次更新后可能同时有多台设备
      // 换了 GUID；旧实现「失败即 break」会让第一台的失败（端点正在重新枚举、
      // 该条记录已失效……）连带吞掉后面所有设备，表现就是「只迁移了一台」。
      // 现在只在**提权类**失败时整轮停止——那种失败下每条记录都会再弹一次 UAC、
      // 再等满一次超时，连续弹窗比不自动更糟；其余失败只跳过这一条。
      if (first && staleRes.status === "fulfilled") {
        const targets = pickAutoRepairTargets(staleRes.value);
        if (targets.length > 0) {
          const restored: string[] = [];
          let failed = 0;
          let elevationBlocked = false;
          for (const item of targets) {
            try {
              await migrateStaleInstall(item.guid, item.target_guid as string, null, null);
              restored.push(item.target_name ?? item.display_name);
            } catch (e: unknown) {
              failed += 1;
              if (isElevationFailure(e)) {
                elevationBlocked = true;
                break;
              }
            }
          }
          if (restored.length > 0) {
            const ui = useUiStore.getState();
            const done =
              restored.length === 1
                ? t("stale.auto.done", { name: restored[0] })
                : t("stale.auto.doneMany", { count: restored.length });
            // 有失败的条目时补一句，避免「已恢复 N 台」把没成的那几台盖掉。
            ui.notify(failed > 0 ? `${done} ${t("stale.auto.partial")}` : done);
            // 迁移后重拉，拿到已归并/清理的列表
            [devRes, staleRes] = await Promise.allSettled([listDevices(), listStaleInstalls()]);
            if (devRes.status === "rejected") throw devRes.reason;
          } else {
            // 提权被拒 → 跳过提示；纯技术失败（端点重枚举等）不能说成「未获授权」。
            useUiStore
              .getState()
              .notify(t(elevationBlocked ? "stale.auto.skipped" : "stale.auto.failed"));
          }
        }
      }

      applyDevices(set, devRes.value);
      const nextStale = staleRes.status === "fulfilled" ? staleRes.value : [];
      // 内容未变时保留旧数组引用：否则每 5s 都会换一次引用，触发整树重渲染
      set((s) => ({
        staleInstalls: staleListsEqual(s.staleInstalls, nextStale) ? s.staleInstalls : nextStale,
      }));
    } catch (e: unknown) {
      get().errorSink?.(friendlyError(e));
    } finally {
      if (first) set({ loading: false });
    }
  },

  /** 低频兜底：重拉 stale 残留列表（外部 APO 安装器等造成的漂移）。
   *  失败静默保留现值——原轮询实现失败时会把列表清成 []，横幅闪没再闪回，
   *  现改为不动，避免抖动。 */
  async loadStale() {
    try {
      const nextStale = await listStaleInstalls();
      set((s) => ({
        staleInstalls: staleListsEqual(s.staleInstalls, nextStale) ? s.staleInstalls : nextStale,
      }));
    } catch {
      /* 保留现值（见上注） */
    }
  },

  async refresh() {
    try {
      const [ds, stale] = await Promise.all([
        listDevices(),
        listStaleInstalls().catch(() => [] as StaleInstall[]),
      ]);
      applyDevices(set, ds);
      set({ staleInstalls: stale });
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

  async migrateStaleSafe(from, to, configFrom, snapshotFrom) {
    try {
      return await get().migrateStale(from, to, configFrom, snapshotFrom);
    } catch (e: unknown) {
      get().errorSink?.(friendlyError(e));
      return null;
    }
  },

  async cleanupStaleSafe(guid) {
    try {
      await get().cleanupStale(guid);
    } catch (e: unknown) {
      get().errorSink?.(friendlyError(e));
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
