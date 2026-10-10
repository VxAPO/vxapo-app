import { useEffect, useRef } from "react";

interface NumInputProps {
  /** store 原始值（须为有限数，调用方先归一）；决定失焦时是否回写收口值 */
  value: number;
  /** 非聚焦时显示的值（默认同 value；效果器卡传显示域 clamped，保持「显示收口、store 存原始键入值」） */
  display?: number;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
  /** 提交键入的原始数值（不夹取；越界收口在失焦时完成） */
  onCommit: (v: number) => void;
}

/**
 * 调音卡片的数字输入框：非受控（defaultValue + 失焦同步）。
 *
 * type=number 的键入中间态（"-"、清空）在浏览器的 value 读取里是空串——
 * 受控回写会把 Number("")=0 立刻顶进输入框，负号根本打不进来。这里键入期间
 * 既不回写 DOM 也不提交 store：中间态解析失败一律丢弃（清空也不归零），
 * 外部值（滑块、回读）聚焦期间不同步；失焦时把最终值夹到 [min,max] 回显并回写，
 * 非法/空输入退回原值。
 */
function NumInput({
  value,
  display,
  min,
  max,
  step,
  disabled,
  className = "gain-input",
  ariaLabel,
  onCommit,
}: NumInputProps) {
  const ref = useRef<HTMLInputElement>(null);
  const show = display ?? value;

  // 非聚焦时把外部变化（滑块拖动、轮询回读、切设备）同步进输入框；
  // 聚焦期间跳过——DOM 里是键入中的文本，回写会打断输入。
  useEffect(() => {
    const el = ref.current;
    if (!el || document.activeElement === el) return;
    const next = String(show);
    if (el.value !== next) el.value = next;
  }, [show]);

  return (
    <input
      ref={ref}
      type="number"
      className={className}
      min={min}
      max={max}
      step={step}
      defaultValue={show}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(e) => {
        const s = e.target.value;
        if (s.trim() === "") return;
        const n = Number(s);
        if (!Number.isNaN(n)) onCommit(n);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      onBlur={(e) => {
        // 失焦收口：非法/空输入退回原显示值，越界夹到 [min,max]，立即回显。
        // 收口值与 store 不一致才回写——键入合法值、未改动的字段不触发 markDirty。
        const el = e.currentTarget;
        const n = Number(el.value);
        const final =
          el.value.trim() === "" || Number.isNaN(n)
            ? show
            : Math.min(max, Math.max(min, n));
        if (el.value !== String(final)) el.value = String(final);
        if (final !== value) onCommit(final);
      }}
    />
  );
}

export default NumInput;
