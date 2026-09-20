// VxAPO App — 设备列表 / 选中设备（决策 4 阶段 A：逻辑已移入 stores/deviceStore）。
//
// 本 hook 只负责三件事：把错误出口与卸载回调注入 store、驱动首次加载与轮询、
// 按原样暴露派生值（installedDevices / selected）。返回值与重构前逐字段一致。
import { useCallback, useEffect, useMemo } from "react";
import { isInstalled } from "../lib/api";
import { t } from "../lib/i18n/core";
import { useDeviceStore } from "../stores/deviceStore";
import { useUiStore } from "../stores/uiStore";
import { useInterval } from "./useInterval";

export function useDevices(paused?: boolean) {
  const devices = useDeviceStore((s) => s.devices);
  const staleInstalls = useDeviceStore((s) => s.staleInstalls);
  const staleBusy = useDeviceStore((s) => s.staleBusy);
  const loading = useDeviceStore((s) => s.loading);
  const selectedGuid = useDeviceStore((s) => s.selectedGuid);
  const uninstallTarget = useDeviceStore((s) => s.uninstallTarget);
  const uninstalling = useDeviceStore((s) => s.uninstalling);
  const setSelectedGuid = useDeviceStore((s) => s.setSelectedGuid);
  const setUninstallTarget = useDeviceStore((s) => s.setUninstallTarget);
  const migrateStale = useDeviceStore((s) => s.migrateStale);
  const cleanupStale = useDeviceStore((s) => s.cleanupStale);
  const migrateStaleSafe = useDeviceStore((s) => s.migrateStaleSafe);
  const cleanupStaleSafe = useDeviceStore((s) => s.cleanupStaleSafe);

  // 错误出口指向 uiStore（决策 4 阶段 A 收尾）：挂载期注入、卸载即摘掉——
  // 等价于重构前用 mountedRef 抑制卸载后的上报。
  useEffect(() => {
    useDeviceStore.getState().setErrorSink(useUiStore.getState().setLoadErr);
    return () => useDeviceStore.getState().setErrorSink(null);
  }, []);

  const load = useCallback((first: boolean) => {
    void useDeviceStore.getState().load(first);
  }, []);

  useEffect(() => {
    load(true);
  }, [load]);

  // 安装进行中暂停轮询：注册表写入后设备会瞬时显示"已安装"，
  // 但标签页要等安装完成（done/failed 后的 onRefresh）才出现。
  useInterval(() => load(false), paused ? null : 5000);

  const installedDevices = useMemo(() => devices.filter(isInstalled), [devices]);
  const selected = devices.find((d) => d.guid === selectedGuid) ?? null;

  const refresh = useCallback(async () => {
    await useDeviceStore.getState().refresh();
  }, []);

  const confirmUninstall = useCallback(async () => {
    const name = await useDeviceStore.getState().confirmUninstall();
    if (name) useUiStore.getState().notify(t("notify.uninstalled", { name }));
  }, []);

  return {
    devices,
    staleInstalls,
    staleBusy,
    loading,
    refresh,
    selectedGuid,
    setSelectedGuid,
    installedDevices,
    selected,
    uninstallTarget,
    setUninstallTarget,
    uninstalling,
    confirmUninstall,
    migrateStale,
    cleanupStale,
    migrateStaleSafe,
    cleanupStaleSafe,
  };
}
