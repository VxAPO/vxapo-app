import { memo } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { t } from "../lib/i18n/core";

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  message: string;
  confirmText?: string;
  confirmVariant?: "danger" | "primary";
  onConfirm: () => void;
}

/** 通用确认弹窗，用于不可逆操作（如删除自定义预设） */
function ConfirmDialog({
  open,
  onOpenChange,
  title,
  message,
  confirmText = t("delete"),
  confirmVariant = "danger",
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="vx-dialog-overlay" />
        <Dialog.Content className="vx-dialog-content" aria-describedby={undefined}>
          <div className="vx-dialog-head">
            <Dialog.Title className="vx-dialog-title">{title}</Dialog.Title>
            <Dialog.Close className="vx-dialog-close" aria-label={t("close")}>
              <X size={16} />
            </Dialog.Close>
          </div>
          <div className="vx-dialog-body">
            <p className="vx-confirm-text">{message}</p>
          </div>
          <div className="vx-dialog-actions">
            <Dialog.Close className="vx-btn ghost" type="button">{t("cancel")}</Dialog.Close>
            <button
              className={`vx-btn ${confirmVariant}`}
              type="button"
              onClick={() => {
                onConfirm();
              }}
            >
              {confirmText}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default memo(ConfirmDialog);
