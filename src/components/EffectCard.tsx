import { X } from "lucide-react";
import type { EffectItem } from "../lib/model";
import { defaultEffectParams, effectDef, effectParams } from "../lib/effects";
import GainSlider from "./GainSlider";
import VxSelect from "./VxSelect";

interface EffectCardProps {
  effect: EffectItem;
  onToggle: (type: string) => void;
  onRemove: (type: string) => void;
  onChangeParam: (type: string, key: string, value: number | string) => void;
}

/** 效果器卡片：中文名 + 开关 + 删除 + 参数 */
export default function EffectCard({ effect, onToggle, onRemove, onChangeParam }: EffectCardProps) {
  const def = effectDef(effect.type);
  const params = { ...defaultEffectParams(effect.type), ...(effect.params ?? {}) };
  const disabled = !effect.enabled;
  const defs = effectParams(effect.type);

  return (
    <div className="effect-card">
      <button
        className="close-x"
        type="button"
        aria-label="删除效果器"
        onClick={() => onRemove(effect.type)}
      >
        <X size={12} strokeWidth={2.5} />
      </button>
      <div className="effect-head">
        <span className="effect-name">{def?.name ?? effect.type}</span>
        <button
          className={`effect-toggle${effect.enabled ? " on" : ""}`}
          type="button"
          aria-pressed={effect.enabled}
          onClick={() => onToggle(effect.type)}
        >
          {effect.enabled ? "开" : "关"}
        </button>
      </div>
      {def?.desc ? <p className="effect-desc">{def.desc}</p> : null}
      {defs.length > 0 && (
        <div className="effect-params">
          {defs.map((p) => {
            const raw = params[p.key];
            if (p.options) {
              return (
                <div className="effect-param-row" key={p.key}>
                  <span className="effect-param-label">{p.label}</span>
                  <VxSelect
                    value={String(raw ?? p.options[0].value)}
                    options={p.options}
                    ariaLabel={p.label}
                    disabled={disabled}
                    onValueChange={(v) => onChangeParam(effect.type, p.key, v)}
                  />
                </div>
              );
            }
            const fallback = defaultEffectParams(effect.type)[p.key];
            const value =
              typeof raw === "number" && Number.isFinite(raw) ? raw : typeof fallback === "number" ? fallback : p.min;
            const clamped = Math.min(p.max, Math.max(p.min, value));
            return (
              <div className="effect-param-row" key={p.key}>
                <span className="effect-param-label">{p.label}</span>
                <GainSlider
                  value={clamped}
                  min={p.min}
                  max={p.max}
                  step={p.step}
                  disabled={disabled}
                  ariaLabel={p.label}
                  onValueChange={(v) => onChangeParam(effect.type, p.key, v)}
                />
                <input
                  type="number"
                  className="gain-input"
                  min={p.min}
                  max={p.max}
                  step={p.step}
                  value={clamped}
                  disabled={disabled}
                  aria-label={p.label}
                  onChange={(e) => onChangeParam(effect.type, p.key, Number(e.target.value))}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
