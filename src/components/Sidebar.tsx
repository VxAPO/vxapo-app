import { memo, useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { X } from "lucide-react";
import type { EffectItem, PeqBandKind, PresetLibraryEntry, SideSection } from "../lib/model";
import { presetAccent, presetCardStyle } from "../lib/blocks";
import { useI18n } from "../lib/i18n";
import { t } from "../lib/i18n/core";
import { EFFECT_DEFS } from "../lib/effects";
import { snapPx } from "../lib/snap";
import PresetDeck from "./PresetDeck";
import OverlayScrollbar from "./OverlayScrollbar";

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
  onAddBand: (kind: PeqBandKind) => void;
  channelOn: boolean;
  activeChannel: string;
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
  activeChannel,
  onToggleChannel,
}: SidebarProps) {
  const lang = useI18n();
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
  const scrollRef = useRef<HTMLDivElement>(null);

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
        <div className="sidebar-scroll-inner os-scroll" ref={scrollRef}>
        <OverlayScrollbar targetRef={scrollRef} rounded />
        <div className="side-seg">
        <div className="labels">
          {SECTIONS.map((s) => (
            <button key={s} type="button" aria-pressed={side === s} onClick={() => onSideChange(s)}>
              {s === "preset" ? t("preset") : s === "custom" ? t("custom") : t("advanced")}
            </button>
          ))}
        </div>
        <div className="track" />
        <div className="ind" style={{ left: `${(side === "preset" ? 0 : side === "custom" ? 1 : 2) * 33.33}%`, width: "33.33%" }} />
        </div>

        {side === "preset" && (
        <PresetDeck library={library} usedPresets={usedPresets} onApplyPreset={onApplyPreset} />
        )}

        {side === "custom" && (
        customPresets.length === 0 ? (
          <p className="preset-empty">{t("empty.customPreset")}</p>
        ) : (
          <div className="preset-list">
            {customPresets.map((p) => {
              const used = usedPresets.includes(p.id);
              const name = lang === "en" ? (p.name_en ?? p.name) : p.name;
              const group = lang === "en" ? (p.group_en ?? p.group) : p.group;
              return (
                <div
                  key={p.id}
                  role="button"
                  tabIndex={used ? undefined : 0}
                  className={`adv-pill preset-pill custom${used ? " disabled" : ""}`}
                  style={presetCardStyle(p.color ?? presetAccent(p.bands))}
                  onClick={used ? undefined : () => onApplyPreset(p)}
                  onKeyDown={
                    used
                      ? undefined
                      : (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onApplyPreset(p);
                          }
                        }
                  }
                  title={used ? `${name}${t("effect.added")}` : name}
                >
                  <span className="preset-dot" aria-hidden="true" />
                  <span className="preset-name">
                    <span className="p-group">{group}</span>
                    <span className="p-sub">{name}</span>
                  </span>
                  {used && <span className="preset-added">{t("effect.added")}</span>}
                  <button
                    className="preset-pill-del"
                    type="button"
                    aria-label={t("delete")}
                    title={t("delete")}
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeletePreset(p);
                    }}
                  >
                    <X size={12} strokeWidth={2.5} />
                  </button>
                </div>
              );
            })}
          </div>
        ))}

        {side === "advanced" && (
        <div className="adv-list">
          <div className="adv-cat">{t("filters")}</div>
          <button className="adv-pill" type="button" onClick={() => onAddBand("peaking")}>
            <Plus size={14} className="adv-plus" />
            <span>{t("peak.filter")}</span>
          </button>
          <button className="adv-pill" type="button" onClick={() => onAddBand("high_shelf")}>
            <Plus size={14} className="adv-plus" />
            <span>{t("filter.highShelf")}</span>
          </button>
          <button className="adv-pill" type="button" onClick={() => onAddBand("low_shelf")}>
            <Plus size={14} className="adv-plus" />
            <span>{t("filter.lowShelf")}</span>
          </button>
          <button className="adv-pill" type="button" onClick={() => onAddBand("low_pass")}>
            <Plus size={14} className="adv-plus" />
            <span>{t("filter.lowPass")}</span>
          </button>
          <button className="adv-pill" type="button" onClick={() => onAddBand("high_pass")}>
            <Plus size={14} className="adv-plus" />
            <span>{t("filter.highPass")}</span>
          </button>
          <div className="adv-cat">{t("effects")}</div>
          {EFFECT_DEFS.map((e) => {
            const added =
              e.type === "preamp" && channelOn
                ? effects.some((x) => x.type === "preamp" && x.channels?.includes(activeChannel))
                : effects.some((x) => x.type === e.type);
            return (
              <button
                className={`adv-pill${added ? " disabled" : ""}`}
                type="button"
                disabled={added}
                key={e.type}
                onClick={() => onAddEffect(e.type)}
              >
                <Plus size={14} className="adv-plus" />
                <span>{added ? `${t(e.name)}${t("effect.added")}` : t(e.name)}</span>
              </button>
            );
          })}
          <div className="adv-cat">{t("channels")}</div>
          <button
            className={`adv-pill ${channelOn ? "active" : ""}`}
            type="button"
            onClick={onToggleChannel}
          >
            <Plus size={14} className="adv-plus" />
            <span>{t("channel.selector")}</span>
          </button>
        </div>
        )}
        </div>
      </div>
      <div
        className={`sidebar-resizer${resizing ? " dragging" : ""}`}
        role="separator"
        aria-orientation="vertical"
        aria-label={t("aria.sidebarWidth")}
        onPointerDown={onResizeDown}
        onPointerMove={onResizeMove}
        onPointerUp={onResizeEnd}
        onPointerCancel={onResizeEnd}
      />
    </aside>
  );
}

export default memo(Sidebar);
