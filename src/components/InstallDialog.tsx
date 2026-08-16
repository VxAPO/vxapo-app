import { memo } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Headphones, Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { friendlyError, installDevice, isInstalled, readProgress } from "../lib/api";
import type { Device } from "../lib/model";
import { t } from "../lib/i18n";

interface InstallDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  devices: Device[];
  onError: (msg: string) => void;
  onRefresh: () => Promise<void> | void;
  onInstalled: (name: string) => void;
}

function InstallDialog({
  open,
  onOpenChange,
  devices,
  onError,
  onRefresh,
  onInstalled,
}: InstallDialogProps) {
  const [installingGuid, setInstallingGuid] = useState<string | null>(null);
  const [progress, setProgress] = useState("");
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!installingGuid) {
      setProgress("");
      return;
    }
    const tag = "install_" + installingGuid.replace(/[{}]/g, "");
    const timer = window.setInterval(async () => {
      const text = await readProgress(tag);
      if (aliveRef.current) setProgress(text);
    }, 400);
    return () => window.clearInterval(timer);
  }, [installingGuid]);

  const handleInstall = async (d: Device) => {
    setInstallingGuid(d.guid);
    try {
      await installDevice(d.guid);
      onInstalled(d.name);
      await onRefresh();
    } catch (e: unknown) {
      onError(friendlyError(e));
    } finally {
      setInstallingGuid(null);
    }
  };

  const candidates = devices.filter((d) => !isInstalled(d));

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="vx-dialog-overlay" />
        <Dialog.Content className="vx-dialog-content install-dialog" aria-describedby={undefined}>
          <div className="vx-dialog-head">
            <Dialog.Title className="vx-dialog-title">{t("install.title")}</Dialog.Title>
            <Dialog.Close className="vx-dialog-close" aria-label={t("close.settings")}>
              <X size={16} />
            </Dialog.Close>
          </div>
          <div className="install-body">
            {candidates.length === 0 ? (
              <div className="install-empty">
                <Headphones size={22} />
                <p>{t("install.empty")}</p>
              </div>
            ) : (
              <div className="install-list">
                {candidates.map((d) => {
                  const busy = installingGuid === d.guid;
                  return (
                    <div className="install-item" key={d.guid}>
                      <div className="install-item-info">
                        <span className="install-item-name">{d.name}</span>
                        <span className="install-item-sub">
                          {d.kind === "capture" ? t("device.capture") : d.kind === "playback" ? t("device.playback") : t("device.type")}
                          {d.channels ? ` · ${d.channels} ${t("device.channels")}` : ""}
                          {d.sample_rate ? ` · ${d.sample_rate} Hz` : ""}
                        </span>
                      </div>
                      <button
                        className="pill install-btn"
                        type="button"
                        disabled={busy}
                        onClick={() => void handleInstall(d)}
                      >
                        {busy ? <span className="vx-spinner" aria-hidden="true" /> : <Plus size={14} />}
                        {busy ? t("install.inProgress") : t("install")}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            <p className="install-hint">{t("install.hint")}</p>
            {progress && <pre className="op-progress">{progress}</pre>}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default memo(InstallDialog);
