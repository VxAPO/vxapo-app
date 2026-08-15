import { memo } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { TriangleAlert, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { readProgress } from "../lib/api";
import type { Device } from "../lib/model";

interface UninstallDialogProps {
  device: Device | null;
  open: boolean;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

function UninstallDialog({
  device,
  open,
  busy,
  onOpenChange,
  onConfirm,
}: UninstallDialogProps) {
  const [progress, setProgress] = useState("");
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!busy || !device) {
      setProgress("");
      return;
    }
    const tag = "uninstall_" + device.guid.replace(/[{}]/g, "");
    const timer = window.setInterval(async () => {
      const text = await readProgress(tag);
      if (aliveRef.current) setProgress(text);
    }, 400);
    return () => window.clearInterval(timer);
  }, [busy, device]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="vx-dialog-overlay" />
        <Dialog.Content className="vx-dialog-content" aria-describedby={undefined}>
          <div className="vx-dialog-head">
            <Dialog.Title className="vx-dialog-title">卸载设备</Dialog.Title>
            <Dialog.Close className="vx-dialog-close" aria-label="关闭卸载确认" disabled={busy}>
              <X size={16} />
            </Dialog.Close>
          </div>
          <div className="uninstall-body">
            <div className="uninstall-icon">
              <TriangleAlert size={20} />
            </div>
            <div className="uninstall-main">
              <p className="uninstall-text">
                确认从 <b className="uninstall-device-name">{device?.name ?? "该设备"}</b> 卸载 VxAPO？
              </p>
              <p className="uninstall-note">
                卸载后该设备的调音配置会保留在 ProgramData 中，重新安装后仍可读取。
              </p>
            </div>
          </div>
          <div className="uninstall-actions">
            <button className="pill" type="button" disabled={busy} onClick={() => onOpenChange(false)}>
              取消
            </button>
            <button className="pill danger-btn" type="button" disabled={busy} onClick={onConfirm}>
              {busy && <span className="vx-spinner" aria-hidden="true" />}
              {busy ? "卸载中…" : "确认卸载"}
            </button>
          </div>
          {progress && <pre className="op-progress">{progress}</pre>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default memo(UninstallDialog);
