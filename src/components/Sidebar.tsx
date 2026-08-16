import { memo, useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { X } from "lucide-react";
import type { EffectItem, PresetLibraryEntry, SideSection } from "../lib/model";
import { presetAccent, presetCardStyle } from "../lib/blocks";
import { EFFECT_DEFS } from "../lib/effects";
import { snapPx } from "../lib/snap";

const SIDEBAR_MIN = 210;
const SECTIONS: SideSection[] = ["preset", "custom", "advanced"];
/** 最大宽度随窗口动态变化：最小窗口（800px）时上限 314，始终给右侧视图留出足够宽度 */
const sidebarMax = () => Math.min(480, Math.max(SIDEBAR_MIN, window.innerWidth - 486));

interface SidebarProps {
  disabled: boolean;
  side: SideSection;
  onSideChange: (s: SideSection) => void;
  library: PresetLibraryEntry[];
  customPresets: PresetLibraryEntry[];
  usedPresets: string[];
  effects: EffectItem[];
  onApplyPreset: (p: PresetLibraryEntry) => void;
  onDeletePreset: (p: PresetLibraryEntry) => void;
  onAddEffect: (type: string) => void;
  onAddBand: () => void;
  channelOn: boolean;
  onToggleChannel: () => void;
}

function Sidebar({
  disabled,
  side,
  onSideChange,
  library,
  customPresets,
  usedPresets,
  effects,
  onApplyPreset,
  onDeletePreset,
  onAddEffect,
  onAddBand,
  channelOn,
  onToggleChannel,
}: SidebarProps) {
  const [sideW, setSideW] = useState<number>(() => {
    try {
      const v = Number(localStorage.getItem("vxapo.sidebarWidth"));
      if (Number.isFinite(v)) return snapPx(Math.min(sidebarMax(), Math.max(SIDEBAR_MIN, v)));
    } catch {
      /* 忽略读取失败 */
    }
    return 220;
  });
  const [resizing, setResizing] = useState(false);
  const resizeStartRef = useRef<{ startX: number; startW: number } | null>(null);
  const resizeRafRef = useRef(0);
  const pendingWRef = useRef<number | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem("vxapo.sidebarWidth", String(sideW));
      document.documentElement.style.setProperty("--sidebar-w", `${sideW}px`);
    } catch {
      /* 忽略写入失败 */
    }
  }, [sideW]);

  useEffect(() => () => window.cancelAnimationFrame(resizeRafRef.current), []);

  useEffect(() => {
    const onResize = () => setSideW((prev) => snapPx(Math.min(sidebarMax(), prev)));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const onResizeDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* 不支持捕获的环境继续走元素事件 */
    }
    resizeStartRef.current = { startX: e.clientX, startW: sideW };
    setResizing(true);
  };

  const onResizeMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const r = resizeStartRef.current;
    if (!r) return;
    pendingWRef.current = Math.min(
      sidebarMax(),
      Math.max(SIDEBAR_MIN, r.startW + (e.clientX - r.startX)),
    );
    if (!resizeRafRef.current) {
      resizeRafRef.current = requestAnimationFrame(() => {
        resizeRafRef.current = 0;
        const w = pendingWRef.current;
        pendingWRef.current = null;
        if (w != null) setSideW(snapPx(w));
      });
    }
  };

  const onResizeEnd = () => {
    window.cancelAnimationFrame(resizeRafRef.current);
    resizeRafRef.current = 0;
    pendingWRef.current = null;
    resizeStartRef.current = null;
    setResizing(false);
  };

  return (
    <aside
      className={`sidebar${resizing ? " resizing" : ""}${disabled ? " disabled" : ""}`}
      aria-disabled={disabled}
      style={{ width: sideW }}
    >
      <div className={`sidebar-scroll${disabled ? " disabled" : ""}`}>
        <div className="sidebar-scroll-inner">
        <div className="side-seg">
        <div className="labels">
          {SECTIONS.map((s) => (
            <button key={s} type="button" aria-pressed={side === s} onClick={() => onSideChange(s)}>
              {s === "preset" ? "预设" : s === "custom" ? "自定义" : "高级"}
            </button>
          ))}
        </div>
        <div className="track" />
        <div className="ind" style={{ left: `${(side === "preset" ? 0 : side === "custom" ? 1 : 2) * 33.33}%`, width: "33.33%" }} />
        </div>

        {side === "preset" && (
        <div className="cards">
          {library.map((p) => {
            const used = usedPresets.includes(p.id);
            const accent = p.color ?? presetAccent(p.bands);
            return (
              <div
                className={`preset-card${used ? " used" : ""}`}
                key={p.id}
                style={presetCardStyle(accent)}
              >
                <p className="p-name"><span className="p-group">{p.group}</span> · {p.name}</p>
                <p className="p-desc">{p.desc}</p>
                <div className="row">
                  <span className="sub">{p.bands.length} 段</span>
                  <button
                    className="add"
                    type="button"
                    disabled={used}
                    onClick={() => onApplyPreset(p)}
                  >
                    {used ? "已添加" : "添加"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        )}

        {side === "custom" && (
        <div className="cards">
          {customPresets.length === 0 ? (
            <div className="preset-card preset-empty">
              <p className="p-desc">暂无自定义预设，框选卡片后可保存</p>
            </div>
          ) : (
            customPresets.map((p) => (
              <div
                className="preset-card"
                key={p.id}
                style={presetCardStyle(p.color ?? presetAccent(p.bands))}
              >
                <button
                  className="preset-del"
                  type="button"
                  aria-label="删除预设"
                  title="删除预设"
                  onClick={() => onDeletePreset(p)}
                >
                  <X size={12} strokeWidth={2.5} />
                </button>
                <p className="p-name"><span className="p-group">{p.group}</span> · {p.name}</p>
                {p.desc ? <p className="p-desc">{p.desc}</p> : null}
                <div className="row">
                  <span className="sub">{p.bands.length} 段</span>
                  <button className="add" type="button" onClick={() => onApplyPreset(p)}>添加</button>
                </div>
              </div>
            ))
          )}
        </div>
        )}

        {side === "advanced" && (
        <div className="adv-list">
          <div className="adv-cat">滤波器</div>
          <button className="adv-pill" type="button" onClick={onAddBand}>
            <Plus size={14} className="adv-plus" />
            <span>峰值滤波器</span>
          </button>
          <button className="adv-pill disabled" type="button" disabled>
            <Plus size={14} className="adv-plus" />
            <span>高架滤波器</span>
          </button>
          <button className="adv-pill disabled" type="button" disabled>
            <Plus size={14} className="adv-plus" />
            <span>低架滤波器</span>
          </button>
          <button className="adv-pill disabled" type="button" disabled>
            <Plus size={14} className="adv-plus" />
            <span>低通滤波器</span>
          </button>
          <button className="adv-pill disabled" type="button" disabled>
            <Plus size={14} className="adv-plus" />
            <span>高通滤波器</span>
          </button>
          <div className="adv-cat">效果器</div>
          {EFFECT_DEFS.map((e) => {
            const added = effects.some((x) => x.type === e.type);
            return (
              <button
                className={`adv-pill${added ? " disabled" : ""}`}
                type="button"
                disabled={added}
                key={e.type}
                onClick={() => onAddEffect(e.type)}
              >
                <Plus size={14} className="adv-plus" />
                <span>{added ? `${e.name}（已添加）` : e.name}</span>
              </button>
            );
          })}
          <div className="adv-cat">通道</div>
          <button
            className={`adv-pill ${channelOn ? "active" : ""}`}
            type="button"
            onClick={onToggleChannel}
          >
            <Plus size={14} className="adv-plus" />
            <span>通道选择器</span>
          </button>
        </div>
        )}
        </div>
      </div>
      <div
        className={`sidebar-resizer${resizing ? " dragging" : ""}`}
        role="separator"
        aria-orientation="vertical"
        aria-label="调整侧边栏宽度"
        onPointerDown={onResizeDown}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeEnd}
        onPointerCancel={onResizeEnd}
      />
    </aside>
  );
}

export default memo(Sidebar);
