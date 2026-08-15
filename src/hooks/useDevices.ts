import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { deviceListsEqual, friendlyError, isInstalled, listDevices, uninstallDevice } from "../lib/api";
import type { Device } from "../lib/model";
import { useInterval } from "./useInterval";

export function useDevices(
  onError: (msg: string) => void,
  onUninstalled?: (name: string) => void,
) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedGuid, setSelectedGuid] = useState<string | null>(null);
  const [uninstallTarget, setUninstallTarget] = useState<Device | null>(null);
  const [uninstalling, setUninstalling] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const load = useCallback(() => {
    listDevices()
      .then((ds) => {
        if (!mountedRef.current) return;
        setDevices((prev) => (deviceListsEqual(prev, ds) ? prev : ds));
        setSelectedGuid((prev) => {
          if (prev && ds.some((d) => d.guid === prev && isInstalled(d))) return prev;
          return ds.find(isInstalled)?.guid ?? null;
        });
      })
      .catch((e: unknown) => {
        if (mountedRef.current) onError(friendlyError(e));
      });
  }, [onError]);

  useEffect(() => {
    void load();
  }, [load]);

  useInterval(load, 5000);

  const installedDevices = useMemo(() => devices.filter(isInstalled), [devices]);
  const selected = devices.find((d) => d.guid === selectedGuid) ?? null;

  const refresh = useCallback(async () => {
    try {
      const ds = await listDevices();
      setDevices((prev) => (deviceListsEqual(prev, ds) ? prev : ds));
      setSelectedGuid((prev) =>
        prev && ds.some((d) => d.guid === prev && isInstalled(d))
          ? prev
          : (ds.find(isInstalled)?.guid ?? null),
      );
    } catch (e: unknown) {
      onError(friendlyError(e));
    }
  }, [onError]);

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
    refresh,
    selectedGuid,
    setSelectedGuid,
    installedDevices,
    selected,
    uninstallTarget,
    setUninstallTarget,
    uninstalling,
    confirmUninstall,
  };
}
