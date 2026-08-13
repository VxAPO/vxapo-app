import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";

export type ThemeMode = "light" | "dark" | "system";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
}

const THEME_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
  { value: "system", label: "跟随系统" },
];

export default function SettingsDialog({
  open,
  onOpenChange,
  theme,
  onThemeChange,
}: SettingsDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="vx-dialog-overlay" />
        <Dialog.Content className="vx-dialog-content" aria-describedby={undefined}>
          <div className="vx-dialog-head">
            <Dialog.Title className="vx-dialog-title">设置</Dialog.Title>
            <Dialog.Close className="vx-dialog-close" aria-label="关闭设置">
              <X size={16} />
            </Dialog.Close>
          </div>

          <div className="vx-dialog-body">
            <div className="vx-setting-row">
              <div className="vx-setting-info">
                <span className="vx-setting-name">主题</span>
                <span className="vx-setting-desc">界面明暗模式</span>
              </div>
              <div className="seg">
                {THEME_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    aria-pressed={theme === o.value}
                    onClick={() => onThemeChange(o.value)}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="vx-setting-row">
              <div className="vx-setting-info">
                <span className="vx-setting-name">语言</span>
                <span className="vx-setting-desc">当前仅简体中文</span>
              </div>
              <span className="vx-setting-value">简体中文</span>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
