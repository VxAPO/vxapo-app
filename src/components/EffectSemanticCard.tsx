import { X } from "lucide-react";
import type { EffectItem } from "../lib/model";
import { defaultEffectParams, effectDef, semanticStrength } from "../lib/effects";
import GainSlider from "./GainSlider";

interface EffectSemanticCardProps {
  effect: EffectItem;
  onToggle: (type: string) => void;
  onRemove: (type: string) => void;
  onStrengthChange: (type: string, strength: number) => void;
}

/** 语义视图效果器卡：只暴露感知强度，参数细调在参数视图 */
export default function EffectSemanticCard({
  effect,
  onToggle,
  onRemove,
  onStrengthChange,
}: EffectSemanticCardProps) {
  const def = effectDef(effect.type);
  const params = { ...defaultEffectParams(effect.type), ...(effect.params ?? {}) };
  const strength = semanticStrength(effect.type, params);
  const disabled = !effect.enabled;

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
      <div className="effect-params">
        <div className="effect-param-row">
          <span className="effect-param-label">强度</span>
          <GainSlider
            value={strength}
            min={0}
            max={1}
            step={0.01}
            disabled={disabled}
            ariaLabel="强度"
            onValueChange={(v) => onStrengthChange(effect.type, v)}
          />
          <span className="g-val">{Math.round(strength * 100)}%</span>
        </div>
      </div>
    </div>
  );
}
