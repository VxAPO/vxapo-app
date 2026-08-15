import { memo } from "react";
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
function EffectSemanticCard({
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
    <>
      <div className="effect-head">
        <button
          className={`effect-dot${effect.enabled ? " on" : ""}`}
          type="button"
          aria-pressed={effect.enabled}
          aria-label={effect.enabled ? "停用效果器" : "启用效果器"}
          title={effect.enabled ? "点击停用效果器" : "点击启用效果器"}
          onClick={() => onToggle(effect.type)}
        />
        <span className="effect-name">{def?.name ?? effect.type}</span>
        <button
          className="close-x"
          type="button"
          aria-label="删除效果器"
          onClick={() => onRemove(effect.type)}
        >
          <X size={12} strokeWidth={2.5} />
        </button>
      </div>
      {def?.desc ? <p className="effect-desc">{def.desc}</p> : null}
      <div className="effect-params">
        <div className="effect-param-row effect-strength-row">
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
    </>
  );
}

export default memo(EffectSemanticCard);
