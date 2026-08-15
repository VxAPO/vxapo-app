import { Plus } from "lucide-react";
import { X } from "lucide-react";
import type { PresetLibraryEntry, SideSection } from "../lib/model";
import { presetAccent } from "../lib/blocks";

interface SidebarProps {
  side: SideSection;
  onSideChange: (s: SideSection) => void;
  library: PresetLibraryEntry[];
  customPresets: PresetLibraryEntry[];
  usedPresets: string[];
  onApplyPreset: (p: PresetLibraryEntry) => void;
  onDeletePreset: (p: PresetLibraryEntry) => void;
  onAddBand: () => void;
  channelOn: boolean;
  onToggleChannel: () => void;
}

export default function Sidebar({
  side,
  onSideChange,
  library,
  customPresets,
  usedPresets,
  onApplyPreset,
  onDeletePreset,
  onAddBand,
  channelOn,
  onToggleChannel,
}: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="side-seg">
        <div className="labels">
          {(["preset", "custom", "advanced"] as SideSection[]).map((s) => (
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
                style={{ "--preset-accent": accent } as React.CSSProperties}
              >
                <p className="p-name">{p.group} · {p.name}</p>
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
                style={{ "--preset-accent": p.color ?? presetAccent(p.bands) } as React.CSSProperties}
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
                <p className="p-name">{p.group} · {p.name}</p>
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
          {["Wide", "Aural", "Reverb", "Maximizer", "Loudness"].map((name) => (
            <button className="adv-pill disabled" type="button" disabled key={name}>
              <Plus size={14} className="adv-plus" />
              <span>{name}</span>
            </button>
          ))}
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
    </aside>
  );
}
