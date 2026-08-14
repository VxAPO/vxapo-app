import * as Dialog from "@radix-ui/react-dialog";
import type { Device } from "../lib/model";

interface UninstallDialogProps {
  device: Device | null;
  open: boolean;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export default function UninstallDialog({
  device,
  open,
  busy,
  onOpenChange,
  onConfirm,
}: UninstallDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="vx-dialog-overlay" />
        <Dialog.Content className="vx-dialog-content" aria-describedby={undefined}>
          <div className="vx-dialog-head">
            <Dialog.Title className="vx-dialog-title">卸载设备</Dialog.Title>
          </div>
          <p className="uninstall-text">
            确认从「{device?.name ?? "该设备"}」卸载 VxAPO？卸载后该设备的调音配置会保留在
            ProgramData 中，重新安装后仍可读取。
          </p>
          <div className="uninstall-actions">
            <button className="pill" type="button" disabled={busy} onClick={() => onOpenChange(false)}>
              取消
            </button>
            <button className="pill danger-btn" type="button" disabled={busy} onClick={onConfirm}>
              {busy ? "卸载中…" : "确认卸载"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
