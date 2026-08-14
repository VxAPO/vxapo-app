import { useEffect, useMemo, useState } from "react";
import { friendlyError, isInstalled, listDevices, uninstallDevice } from "../lib/api";
import type { Device } from "../lib/model";

export function useDevices(onError: (msg: string) => void) {
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
            if (prev && ds.some((d) => d.guid === prev)) return prev;
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

  const confirmUninstall = async () => {
    if (!uninstallTarget) return;
    setUninstalling(true);
    try {
      await uninstallDevice(uninstallTarget.guid);
      setUninstallTarget(null);
    } catch (e: unknown) {
      onError(friendlyError(e));
    } finally {
      setUninstalling(false);
    }
  };

  return {
    devices,
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
