import { Copy, Minus, SlidersHorizontal, Square, Tags, X } from "lucide-react";
import type { ViewMode } from "../lib/model";
import logoUrl from "../assets/VxAPO_icon_v4.svg";

interface TopBarProps {
  view: ViewMode;
  channelOn: boolean;
  noDevices: boolean;
  segDir: "left" | "right";
  isMax: boolean;
  onViewChange: (v: ViewMode) => void;
  onOpenSettings: () => void;
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onClose: () => void;
}

export default function TopBar({
  view,
  channelOn,
  noDevices,
  segDir,
  isMax,
  onViewChange,
  onOpenSettings,
  onMinimize,
  onToggleMaximize,
  onClose,
}: TopBarProps) {
  return (
    <div className="topbar" data-tauri-drag-region>
      <img className="logo" src={logoUrl} alt="VxAPO" draggable={false} />
      <button className="pill" type="button" onClick={onOpenSettings}>设置</button>
      <button className="pill" type="button" disabled={noDevices}>导入</button>
      <button className="pill" type="button" disabled={noDevices}>导出</button>
      <span className="spacer" data-tauri-drag-region />
      <div className="seg view-seg" data-dir={segDir} role="radiogroup" aria-label="视图切换">
        <span className={`seg-thumb ${view === "advanced" ? "right" : ""}`} />
        <button type="button" disabled={channelOn || noDevices} aria-pressed={view === "preset"} onClick={() => onViewChange("preset")}>
          <Tags size={13} />
          语义视图
        </button>
        <button type="button" disabled={noDevices} aria-pressed={view === "advanced"} onClick={() => onViewChange("advanced")}>
          <SlidersHorizontal size={13} />
          参数视图
        </button>
      </div>
      <span className="spacer" data-tauri-drag-region />
      <button className="pill winbtn" type="button" aria-label="最小化" onClick={onMinimize}>
        <Minus size={16} />
      </button>
      <button className="pill winbtn" type="button" aria-label={isMax ? "还原" : "最大化"} onClick={onToggleMaximize}>
        {isMax ? <Copy size={14} /> : <Square size={13} />}
      </button>
      <button className="pill winbtn close" type="button" aria-label="关闭" onClick={onClose}>
        <X size={16} />
      </button>
    </div>
  );
}
