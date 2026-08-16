import { memo, useRef, useState, type CSSProperties } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ThemeMode } from "../lib/model";

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

function SettingsDialog({
  open,
  onOpenChange,
  theme,
  onThemeChange,
}: SettingsDialogProps) {
  const themeIndex = THEME_OPTIONS.findIndex((o) => o.value === theme);
  // 容器固定 240px，内边距 3px*2，gap 2px*2，三个等宽按钮
  const themeThumbWidth = ((240 - 6 - 4) / 3 / 240) * 100;
  const themeThumbLeft = ((3 + themeIndex * ((240 - 6 - 4) / 3 + 2)) / 240) * 100;

  // 点击切换后锁住 hover 背景，直到指针移动/离开后才恢复；
  // 避免旧按钮的 hover 胶囊与 thumb 平移动画重叠或动画结束后“残留”。
  const [themeHoverLock, setThemeHoverLock] = useState(false);
  const hoverLockUntilRef = useRef(0);

  const handleThemeChange = (value: ThemeMode) => {
    setThemeHoverLock(true);
    hoverLockUntilRef.current = Date.now() + 400;
    onThemeChange(value);
  };

  const handleThemePointerMove = () => {
    if (themeHoverLock && Date.now() > hoverLockUntilRef.current) {
      setThemeHoverLock(false);
    }
  };

  const handleThemePointerLeave = () => {
    setThemeHoverLock(false);
  };
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
              <div
                className={`seg theme-seg${themeHoverLock ? " no-hover" : ""}`}
                onMouseMove={handleThemePointerMove}
                onMouseLeave={handleThemePointerLeave}
              >
                <span
                  className="theme-seg-thumb"
                  aria-hidden
                  style={{ left: `${themeThumbLeft}%`, width: `${themeThumbWidth}%` } as CSSProperties}
                />
                {THEME_OPTIONS.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    aria-pressed={theme === o.value}
                    onClick={() => handleThemeChange(o.value)}
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

export default memo(SettingsDialog);
