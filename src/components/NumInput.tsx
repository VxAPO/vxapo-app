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
  /**
   * 显示与失焦收口的小数位（默认 2，输入框不暴露长浮点）。
   * Hz 类频率参数传 0——频率输入一律整数（失焦时四舍五入入 store）。
   */
  precision?: number;
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
  precision = 2,
  onCommit,
}: NumInputProps) {
  const ref = useRef<HTMLInputElement>(null);
  const show = display ?? value;
  // 显示与失焦收口都按 precision 收敛：rest 态不暴露长浮点（如 1.76993 → 1.77），
  // Hz 类频率传 0 则整数化（-0 归一为 0，避免 String(-0) 之外的下游怪癖）。
  const round = (v: number) => {
    const r = Math.round(v * 10 ** precision) / 10 ** precision;
    return r === 0 ? 0 : r;
  };
  const shown = round(show);

  // 非聚焦时把外部变化（滑块拖动、轮询回读、切设备）同步进输入框；
  // 聚焦期间跳过——DOM 里是键入中的文本，回写会打断输入。
  useEffect(() => {
    const el = ref.current;
    if (!el || document.activeElement === el) return;
    const next = String(shown);
    if (el.value !== next) el.value = next;
  }, [shown]);

  return (
    <input
      ref={ref}
      type="number"
      className={className}
      min={min}
      max={max}
      step={step}
      defaultValue={shown}
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
        // 失焦收口：按 precision 收敛（频率整数、其余 2 位），再夹到 [min,max]。
        // 非法/空输入退回原显示值；收口值与 store 不一致才回写——键入合法值、
        // 未改动的字段不触发 markDirty；store 里残留的长浮点在首次失焦时被规整。
        const el = e.currentTarget;
        const n = Number(el.value);
        const final =
          el.value.trim() === "" || Number.isNaN(n)
            ? shown
            : Math.min(max, Math.max(min, round(n)));
        if (el.value !== String(final)) el.value = String(final);
        if (final !== value) onCommit(final);
      }}
    />
  );
}

export default NumInput;
