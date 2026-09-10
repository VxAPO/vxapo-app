import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { useInterval } from "./useInterval";

/** 逐项浅比较，避免轮询无变化时替换数组引用。 */
function staleListsEqual(a: StaleInstall[], b: StaleInstall[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every((s, i) => JSON.stringify(s) === JSON.stringify(b[i]));
}

export function useDevices(
  onError: (msg: string) => void,
  onUninstalled?: (name: string) => void,
  paused?: boolean,
) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [staleInstalls, setStaleInstalls] = useState<StaleInstall[]>([]);
  const [staleBusy, setStaleBusy] = useState(false);
  const [selectedGuid, setSelectedGuid] = useState<string | null>(null);
  const [uninstallTarget, setUninstallTarget] = useState<Device | null>(null);
  const [uninstalling, setUninstalling] = useState(false);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);
  const firstLoadRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(() => {
    if (firstLoadRef.current) setLoading(true);
    Promise.allSettled([listDevices(), listStaleInstalls()])
      .then(([devRes, staleRes]) => {
        if (!mountedRef.current) return;
        if (devRes.status === "rejected") throw devRes.reason;
        const ds = devRes.value;
        setDevices((prev) => (deviceListsEqual(prev, ds) ? prev : ds));
        const nextStale =
          staleRes.status === "fulfilled" ? staleRes.value : [];
        // 内容未变时保留旧数组引用：否则每 5s 都会换一次引用，触发整树重渲染
        setStaleInstalls((prev) => {
          if (staleListsEqual(prev, nextStale)) return prev;
          return nextStale;
        });
        setSelectedGuid((prev) => {
          if (prev && ds.some((d) => d.guid === prev && isInstalled(d))) return prev;
          return ds.find(isInstalled)?.guid ?? null;
        });
      })
      .catch((e: unknown) => {
        if (mountedRef.current) onError(friendlyError(e));
      })
      .finally(() => {
        if (mountedRef.current && firstLoadRef.current) {
          firstLoadRef.current = false;
          setLoading(false);
        }
      });
  }, [onError]);

  useEffect(() => {
    void load();
  }, [load]);

  // 安装进行中暂停轮询：注册表写入后设备会瞬时显示"已安装"，
  // 但标签页要等安装完成（done/failed 后的 onRefresh）才出现。
  useInterval(load, paused ? null : 5000);

  const installedDevices = useMemo(() => devices.filter(isInstalled), [devices]);
  const selected = devices.find((d) => d.guid === selectedGuid) ?? null;

  const refresh = useCallback(async () => {
    try {
      const [ds, stale] = await Promise.all([
        listDevices(),
        listStaleInstalls().catch(() => [] as StaleInstall[]),
      ]);
      setDevices((prev) => (deviceListsEqual(prev, ds) ? prev : ds));
      setStaleInstalls(stale);
      setSelectedGuid((prev) =>
        prev && ds.some((d) => d.guid === prev && isInstalled(d))
          ? prev
          : (ds.find(isInstalled)?.guid ?? null),
      );
    } catch (e: unknown) {
      onError(friendlyError(e));
    }
  }, [onError]);

  const migrateStale = useCallback(
    async (
      from: string,
      to: string,
      configFrom?: string | null,
      snapshotFrom?: string | null,
    ): Promise<MigrationReport | null> => {
      setStaleBusy(true);
      try {
        const report = await migrateStaleInstall(from, to, configFrom, snapshotFrom);
        await refresh();
        return report;
      } finally {
        setStaleBusy(false);
      }
    },
    [refresh],
  );

  const cleanupStale = useCallback(
    async (guid: string) => {
      setStaleBusy(true);
      try {
        await cleanupStaleInstall(guid);
        await refresh();
      } finally {
        setStaleBusy(false);
      }
    },
    [refresh],
  );

  const confirmUninstall = useCallback(async () => {
    if (!uninstallTarget) return;
    const target = uninstallTarget;
    setUninstalling(true);
    try {
      await uninstallDevice(target.guid);
      // 成功后：清掉历史错误、提示成功、立即刷新列表并回退到已有标签
      onError("");
      onUninstalled?.(target.name);
      await refresh();
      setUninstallTarget(null);
    } catch (e: unknown) {
      onError(friendlyError(e));
    } finally {
      setUninstalling(false);
    }
  }, [uninstallTarget, onError, onUninstalled, refresh]);

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
  };
}
