import { useCallback, useEffect, useMemo, useState } from "react";
import { friendlyError, isInstalled, listDevices, uninstallDevice } from "../lib/api";
import type { Device } from "../lib/model";

export function useDevices(
  onError: (msg: string) => void,
  onUninstalled?: (name: string) => void,
) {
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedGuid, setSelectedGuid] = useState<string | null>(null);
  const [uninstallTarget, setUninstallTarget] = useState<Device | null>(null);
  const [uninstalling, setUninstalling] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () =>
      listDevices()
        .then((ds) => {
          if (!alive) return;
          setDevices(ds);
          setSelectedGuid((prev) => {
            if (prev && ds.some((d) => d.guid === prev && isInstalled(d))) return prev;
            return ds.find(isInstalled)?.guid ?? null;
          });
        })
        .catch((e: unknown) => {
          if (alive) onError(friendlyError(e));
        });
    load();
    const timer = window.setInterval(load, 5000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [onError]);

  const installedDevices = useMemo(() => devices.filter(isInstalled), [devices]);
  const selected = devices.find((d) => d.guid === selectedGuid) ?? null;

  const refresh = useCallback(async () => {
    try {
      const ds = await listDevices();
      setDevices(ds);
      setSelectedGuid((prev) =>
        prev && ds.some((d) => d.guid === prev && isInstalled(d))
          ? prev
          : (ds.find(isInstalled)?.guid ?? null),
      );
    } catch (e: unknown) {
      onError(friendlyError(e));
    }
  }, [onError]);

  const confirmUninstall = async () => {
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
  };

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
