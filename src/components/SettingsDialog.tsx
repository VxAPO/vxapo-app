import { memo, useRef, useState, type CSSProperties } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { StaleInstall, ThemeMode } from "../lib/model";
import { useI18n } from "../lib/i18n";
import { setLang, t } from "../lib/i18n/core";
import { writeLang } from "../lib/api";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  theme: ThemeMode;
  onThemeChange: (theme: ThemeMode) => void;
  staleUnmatched?: StaleInstall[];
  staleBusy?: boolean;
  onCleanupStale?: (guid: string) => Promise<void>;
}

const THEME_OPTIONS: { value: ThemeMode; key: string }[] = [
  { value: "light", key: "theme.light" },
  { value: "dark", key: "theme.dark" },
  { value: "system", key: "theme.system" },
];

function SettingsDialog({
  open,
  onOpenChange,
  theme,
  onThemeChange,
  staleUnmatched = [],
  staleBusy = false,
  onCleanupStale,
}: SettingsDialogProps) {
  const lang = useI18n();
  const themeIndex = THEME_OPTIONS.findIndex((o) => o.value === theme);
  // 容器固定 240px，内边距 3px*2，gap 2px*2，三个等宽按钮
  const themeThumbWidth = ((240 - 6 - 4) / 3 / 240) * 100;
  const themeThumbLeft = ((3 + themeIndex * ((240 - 6 - 4) / 3 + 2)) / 240) * 100;
  const langThumbWidth = ((240 - 6 - 2) / 2 / 240) * 100;
  const langThumbLeft = lang === "zh" ? (3 / 240) * 100 : ((3 + (240 - 6 - 2) / 2 + 2) / 240) * 100;

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
            <Dialog.Title className="vx-dialog-title">{t("settings")}</Dialog.Title>
            <Dialog.Close className="vx-dialog-close" aria-label={t("close.settings")}>
              <X size={16} />
            </Dialog.Close>
          </div>

          <div className="vx-dialog-body">
            <div className="vx-setting-row">
              <div className="vx-setting-info">
                <span className="vx-setting-name">{t("theme")}</span>
                <span className="vx-setting-desc">{t("theme.desc")}</span>
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
                    {t(o.key)}
                  </button>
                ))}
              </div>
            </div>

            <div className="vx-setting-row">
              <div className="vx-setting-info">
                <span className="vx-setting-name">{t("language")}</span>
                <span className="vx-setting-desc">{t("language.desc")}</span>
              </div>
              <div className="seg theme-seg" style={{ width: 240 }}>
                <span
                  className="theme-seg-thumb"
                  aria-hidden
                  style={{ left: `${langThumbLeft}%`, width: `${langThumbWidth}%` } as CSSProperties}
                />
                {(["zh", "en"] as const).map((l) => (
                  <button
                    key={l}
                    type="button"
                    aria-pressed={lang === l}
                    onClick={() => {
                      onOpenChange(false);
                      setLang(l);
                      void writeLang(l);
                    }}
                  >
                    {t(l === "zh" ? "language.zh" : "language.en")}
                  </button>
                ))}
              </div>
            </div>

            {staleUnmatched.length > 0 && (
              <div className="vx-setting-row">
                <div className="vx-setting-info">
                  <span className="vx-setting-name">{t("stale.settings.name")}</span>
                  <span className="vx-setting-desc">
                    {t("stale.settings.desc", { count: staleUnmatched.length })}
                  </span>
                </div>
                <button
                  className="stale-banner-btn"
                  type="button"
                  disabled={staleBusy}
                  onClick={() => {
                    if (!onCleanupStale) return;
                    void (async () => {
                      for (const item of staleUnmatched) {
                        await onCleanupStale(item.guid);
                      }
                    })();
                  }}
                >
                  {t("stale.cleanup")}
                </button>
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default memo(SettingsDialog);
