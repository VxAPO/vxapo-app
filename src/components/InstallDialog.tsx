import * as Dialog from "@radix-ui/react-dialog";
import { Headphones, Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { friendlyError, installDevice, isInstalled, readProgress } from "../lib/api";
import type { Device } from "../lib/model";

interface InstallDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  devices: Device[];
  onError: (msg: string) => void;
  onRefresh: () => Promise<void> | void;
  onInstalled: (name: string) => void;
}

export default function InstallDialog({
  open,
  onOpenChange,
  devices,
  onError,
  onRefresh,
  onInstalled,
}: InstallDialogProps) {
  const [installingGuid, setInstallingGuid] = useState<string | null>(null);
  const [progress, setProgress] = useState("");

  useEffect(() => {
    if (!installingGuid) {
      setProgress("");
      return;
    }
    const tag = "install_" + installingGuid.replace(/[{}]/g, "");
    const timer = window.setInterval(async () => {
      setProgress(await readProgress(tag));
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
            <Dialog.Title className="vx-dialog-title">安装新设备</Dialog.Title>
            <Dialog.Close className="vx-dialog-close" aria-label="关闭安装页面">
              <X size={16} />
            </Dialog.Close>
          </div>
          <div className="install-body">
            {candidates.length === 0 ? (
              <div className="install-empty">
                <Headphones size={22} />
                <p>未检测到可安装的设备</p>
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
                          {d.kind === "capture" ? "捕获设备" : d.kind === "playback" ? "播放设备" : "音频设备"}
                          {d.channels ? ` · ${d.channels} 通道` : ""}
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
                        {busy ? "安装中…" : "安装"}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            <p className="install-hint">安装时会弹出系统权限确认，完成后设备会出现在顶部标签页。</p>
            {progress && <pre className="op-progress">{progress}</pre>}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
