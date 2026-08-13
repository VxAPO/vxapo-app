import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronRight,
  Copy,
  Minus,
  Save,
  Settings,
  Share2,
  Square,
  Upload,
  X,
} from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Theme } from "../types";
import logo from "../assets/logo.png";

const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
const appWindow = () => (isTauri() ? getCurrentWindow() : null);

const minimizeWindow = () => void appWindow()?.minimize();
const toggleMaximizeWindow = () => void appWindow()?.toggleMaximize();
const closeWindow = () => void appWindow()?.close();
const startWindowDrag = () => void appWindow()?.startDragging();

interface HeaderProps {
  theme: Theme;
  onThemeChange: (t: Theme) => void;
  loudnessEnabled: boolean;
  onLoudnessChange: (v: boolean) => void;
  saved: boolean;
  onSave: () => void;
  onImport: () => void;
  onExport: () => void;
}

const THEME_LABELS: Record<Theme, string> = {
  light: "浅色模式",
  dark: "深色模式",
  system: "跟随系统",
};

export default function Header({
  theme,
  onThemeChange,
  loudnessEnabled,
  onLoudnessChange,
  saved,
  onSave,
  onImport,
  onExport,
}: HeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [submenu, setSubmenu] = useState<"theme" | "loudness" | null>(null);
  const [maximized, setMaximized] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const app = appWindow();
    if (!app) return;
    let disposed = false;
    const sync = () => {
      app
        .isMaximized()
        .then((v) => {
          if (!disposed) setMaximized(v);
        })
        .catch(() => {});
    };
    sync();
    const un1 = app.onResized(sync);
    const un2 = app.onMoved(sync);
    return () => {
      disposed = true;
      un1.then((f) => f());
      un2.then((f) => f());
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (anchorRef.current && !anchorRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setSubmenu(null);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  return (
    <header className="top-bar">
      <div className="logo">
        <img src={logo} alt="VxAPO" className="logo-img" draggable={false} />
      </div>

      <div className="tool-group">
        <div className="menu-anchor" ref={anchorRef}>
          <button
            className="icon-btn tooltip btn-press"
            data-tip="设置"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="设置"
          >
            <Settings size={16} />
          </button>
          {menuOpen && (
            <div className="settings-menu">
              <div
                className="menu-item"
                onMouseEnter={() => setSubmenu("theme")}
                onClick={() => setSubmenu("theme")}
              >
                默认主题
                <ChevronRight size={14} className="menu-caret" />
                {submenu === "theme" && (
                  <div className="submenu">
                    {(Object.keys(THEME_LABELS) as Theme[]).map((t) => (
                      <div
                        key={t}
                        className={`menu-item ${theme === t ? "selected" : ""}`}
                        onClick={() => {
                          onThemeChange(t);
                          setMenuOpen(false);
                          setSubmenu(null);
                        }}
                      >
                        {THEME_LABELS[t]}
                        {theme === t && <Check size={14} className="check" />}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div
                className="menu-item"
                onMouseEnter={() => setSubmenu("loudness")}
                onClick={() => setSubmenu("loudness")}
              >
                响度补偿
                <ChevronRight size={14} className="menu-caret" />
                {submenu === "loudness" && (
                  <div className="submenu">
                    <div
                      className={`menu-item ${loudnessEnabled ? "selected" : ""}`}
                      onClick={() => {
                        onLoudnessChange(true);
                        setMenuOpen(false);
                        setSubmenu(null);
                      }}
                    >
                      开
                      {loudnessEnabled && <Check size={14} className="check" />}
                    </div>
                    <div
                      className={`menu-item ${!loudnessEnabled ? "selected" : ""}`}
                      onClick={() => {
                        onLoudnessChange(false);
                        setMenuOpen(false);
                        setSubmenu(null);
                      }}
                    >
                      关
                      {!loudnessEnabled && <Check size={14} className="check" />}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        <button
          className="icon-btn tooltip btn-press"
          data-tip={saved ? "已保存" : "保存"}
          onClick={onSave}
          aria-label="保存"
        >
          <Save size={16} />
        </button>
        <button className="icon-btn tooltip btn-press" data-tip="导入" onClick={onImport} aria-label="导入">
          <Upload size={16} />
        </button>
        <button className="icon-btn tooltip btn-press" data-tip="导出" onClick={onExport} aria-label="导出">
          <Share2 size={16} />
        </button>
      </div>

      <div
        className="drag-region"
        onPointerDown={(e) => {
          if (e.button === 0) startWindowDrag();
        }}
        onDoubleClick={toggleMaximizeWindow}
      />

      <div className="window-controls">
        <button className="icon-btn btn-press" aria-label="最小化" onClick={minimizeWindow}>
          <Minus size={14} />
        </button>
        <button
          className="icon-btn btn-press"
          aria-label={maximized ? "还原" : "最大化"}
          onClick={toggleMaximizeWindow}
        >
          {maximized ? <Copy size={12} /> : <Square size={12} />}
        </button>
        <button className="icon-btn close-btn btn-press" aria-label="关闭" onClick={closeWindow}>
          <X size={14} />
        </button>
      </div>

    </header>
  );
}
