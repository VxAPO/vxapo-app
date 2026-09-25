import { memo } from "react";
import { Copy, Minus, SlidersHorizontal, Square, Tags, X } from "lucide-react";
import type { ViewMode } from "../lib/model";
import { t } from "../lib/i18n/core";
import logoUrl from "../assets/VxAPO_icon_v4.svg";
import { isInstalled } from "../lib/api";
import { useChannelStore } from "../stores/channelStore";
import { useDeviceStore } from "../stores/deviceStore";

interface TopBarProps {
  view: ViewMode;
  segDir: "left" | "right";
  isMax: boolean;
  onViewChange: (v: ViewMode) => void;
  onOpenSettings: () => void;
  onImport: () => void;
  onExport: () => void;
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onClose: () => void;
}

/** 顶栏（设置 / 导入导出 / 视图切换 / 窗口控制）。 */
function TopBar({
  view,
  segDir,
  isMax,
  onViewChange,
  onOpenSettings,
  onImport,
  onExport,
  onMinimize,
  onToggleMaximize,
  onClose,
}: TopBarProps) {
  // 决策 4 阶段 A：设备/通道状态直接订阅 store。
  const channelOn = useChannelStore((s) => s.channelOn);
  const noDevices = useDeviceStore((s) => s.devices.filter(isInstalled).length === 0);
  return (
    <div className="topbar" data-tauri-drag-region>
      <img className="logo" src={logoUrl} alt="VxAPO" draggable={false} />
      <button className="pill" type="button" onClick={onOpenSettings}>{t("settings")}</button>
      <button className="pill" type="button" disabled={noDevices} onClick={onImport}>{t("import")}</button>
      <button className="pill" type="button" disabled={noDevices} onClick={onExport}>{t("export")}</button>
      <span className="spacer" data-tauri-drag-region />
      {/* 视图切换外面这圈是「死区」：容器不挂 data-tauri-drag-region，点歪到控件四周
          不会落到顶栏/占位条的拖拽区上，也就不会触发双击最大化/还原。靠 padding 撑出这一圈，
          居中仍由它负责，视觉与布局不变（尺寸见 topbar.css 的 .view-seg-zone）。 */}
      <span className="view-seg-zone">
        <div className="seg view-seg" data-dir={segDir} role="radiogroup" aria-label={t("view.switch")}>
          <span className={`seg-thumb ${view === "advanced" ? "right" : ""}`} />
          {/* 打开通道选择器不再禁用语义视图：语义视图同样按声道过滤内容（PresetView 的 visible），
              声道切换入口是曲线卡上的选择器，两个视图都能用 */}
          <button type="button" disabled={noDevices} aria-pressed={view === "preset"} onClick={() => onViewChange("preset")}>
            <Tags size={13} />
            {t("view.semantic")}
          </button>
          <button type="button" disabled={noDevices} aria-pressed={view === "advanced"} onClick={() => onViewChange("advanced")}>
            <SlidersHorizontal size={13} />
            {t("view.params")}
          </button>
        </div>
      </span>
      <span className="spacer" data-tauri-drag-region />
      <button className="pill winbtn" type="button" aria-label={t("minimize")} onClick={onMinimize}>
        <Minus size={16} />
      </button>
      <button className="pill winbtn" type="button" aria-label={isMax ? t("restore") : t("maximize")} onClick={onToggleMaximize}>
        {isMax ? <Copy size={14} /> : <Square size={13} />}
      </button>
      <button className="pill winbtn close" type="button" aria-label={t("close.window")} onClick={onClose}>
        <X size={16} />
      </button>
    </div>
  );
}

export default memo(TopBar);
