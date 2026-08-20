import { memo } from "react";
import { X } from "lucide-react";
import type { EffectItem } from "../lib/model";
import { defaultEffectParams, effectDef, effectParams } from "../lib/effects";
import { t } from "../lib/i18n/core";
import GainSlider from "./GainSlider";
import VxSelect from "./VxSelect";

interface EffectCardProps {
  effect: EffectItem;
  onToggle: (type: string) => void;
  onRemove: (type: string) => void;
  onChangeParam: (type: string, key: string, value: number | string) => void;
}

/** 效果器卡片：中文名 + 开关 + 删除 + 参数 */
function EffectCard({ effect, onToggle, onRemove, onChangeParam }: EffectCardProps) {
  const def = effectDef(effect.type);
  const params = { ...defaultEffectParams(effect.type), ...(effect.params ?? {}) };
  const disabled = !effect.enabled;
  const defs = effectParams(effect.type);

  return (
    <>
      <div className="effect-head">
        <button
          className={`effect-dot${effect.enabled ? " on" : ""}`}
          type="button"
          aria-pressed={effect.enabled}
          aria-label={effect.enabled ? t("disable.filter") : t("enable.filter")}
          title={effect.enabled ? t("disable.filter") : t("enable.filter")}
          onClick={() => onToggle(effect.id ?? effect.type)}
        />
        <span className="effect-name">{def ? t(def.name) : effect.type}</span>
        {effect.type === "preamp" && effect.channels?.length ? (
          <span className="effect-channel">{effect.channels.join("/")}</span>
        ) : null}
        <button
          className="close-x"
          type="button"
          aria-label={t("aria.delete")}
          onClick={() => onRemove(effect.id ?? effect.type)}
        >
          <X size={12} strokeWidth={2.5} />
        </button>
      </div>
      {defs.length > 0 && (
        <div className="effect-params">
          {defs.map((p) => {
            const raw = params[p.key];
            if (p.options) {
              // 驱动可能写入数字索引（0-3）或未知字符串：规整成合法选项值，
              // 保证 Radix Select 的受控值始终可选中
              const optionValues = p.options.map((o) => o.value);
              const rawValue = raw ?? p.options[0].value;
              const validValue =
                typeof rawValue === "number"
                  ? p.options[rawValue]?.value ?? p.options[0].value
                  : optionValues.includes(String(rawValue))
                    ? String(rawValue)
                    : p.options[0].value;
              return (
                <div className="effect-param-row" key={p.key}>
                  <span className="effect-param-label">{t(p.label)}</span>
                  <VxSelect
                    value={validValue}
                    options={p.options.map((o) => ({ ...o, label: t(o.label) }))}
                    ariaLabel={p.label}
                    disabled={disabled}
                    onValueChange={(v) => onChangeParam(effect.id ?? effect.type, p.key, v)}
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
                <span className="effect-param-label">{t(p.label)}</span>
                <GainSlider
                  value={clamped}
                  min={p.min}
                  max={p.max}
                  step={p.step}
                  disabled={disabled}
                  ariaLabel={p.label}
                  onValueChange={(v) => onChangeParam(effect.id ?? effect.type, p.key, v)}
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
                  onChange={(e) => onChangeParam(effect.id ?? effect.type, p.key, Number(e.target.value))}
                />
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

export default memo(EffectCard);
