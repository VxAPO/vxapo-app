import { memo } from "react";
import { X } from "lucide-react";
import type { EffectItem } from "../lib/model";
import { defaultEffectParams, effectDef, effectParams, paramToSliderPos, sliderPosToParam } from "../lib/effects";
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
            const fallback = defaultEffectParams(effect.type)[p.key];
            const value =
              typeof raw === "number" && Number.isFinite(raw) ? raw : typeof fallback === "number" ? fallback : p.min;
            const clamped = Math.min(p.max, Math.max(p.min, value));
            if (p.seg) {
              // 分段滑块（settings 深浅切换形态）：带 thumb 的长滑块 + 文字档位，
              // 不带数字输入框；历史手输值就近吸附到档位（首次点击即落到精确档）。
              const segs = p.seg;
              const n = segs.length;
              let idx = segs.findIndex((o) => Number(o.value) === clamped);
              if (idx < 0) {
                idx = 0;
                for (let i = 1; i < n; i++) {
                  if (
                    Math.abs(Number(segs[i].value) - clamped) <
                    Math.abs(Number(segs[idx].value) - clamped)
                  ) {
                    idx = i;
                  }
                }
              }
              const pad = 3;
              const gap = 2; // 与 .seg 样式一致（padding3px、gap2px）
              const span = `100% - ${pad * 2}px - ${(n - 1) * gap}px`;
              return (
                <div className="effect-param-row" key={p.key}>
                  <span className="effect-param-label">{t(p.label)}</span>
                  <div className="seg theme-seg effect-seg" role="group" aria-label={p.label}>
                    <span
                      className="theme-seg-thumb"
                      aria-hidden
                      style={{
                        left: `calc(${pad}px + ${idx} * ((${span}) / ${n} + ${gap}px))`,
                        width: `calc((${span}) / ${n})`,
                      }}
                    />
                    {segs.map((o, i) => (
                      <button
                        key={o.value}
                        type="button"
                        aria-pressed={i === idx}
                        onClick={() => onChangeParam(effect.id ?? effect.type, p.key, Number(o.value))}
                      >
                        {t(o.label)}
                      </button>
                    ))}
                  </div>
                </div>
              );
            }
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
            // 曲线行程参数（如压缩比）：滑杆走映射后的位置（按感知量均匀），
            // 数字输入框仍显示/输入原始 x:1 数值与原始步进。
            if (p.curve) {
              return (
                <div className="effect-param-row" key={p.key}>
                  <span className="effect-param-label">{t(p.label)}</span>
                  <GainSlider
                    value={paramToSliderPos(effect.type, p.key, clamped)}
                    min={0}
                    max={1}
                    step={0.01}
                    disabled={disabled}
                    ariaLabel={p.label}
                    onValueChange={(v) =>
                      onChangeParam(effect.id ?? effect.type, p.key, sliderPosToParam(effect.type, p.key, v))
                    }
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
            }
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
