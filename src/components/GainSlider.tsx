import {
  useCallback,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

interface GainSliderProps {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  onValueChange: (value: number) => void;
  ariaLabel?: string;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * 轻量滑块：替代 Radix Slider（参数卡每张 3 个、31 段共 93 个，Radix 挂载开销
 * 会把视图切换首帧拖到 100ms+）。复用 .gs-* 样式，指针/键盘行为对齐 Radix。
 */
export default function GainSlider({
  value,
  min = -12,
  max = 12,
  step = 0.1,
  disabled = false,
  onValueChange,
  ariaLabel = "Gain",
}: GainSliderProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);

  const valueAt = useCallback(
    (clientX: number) => {
      const el = rootRef.current;
      if (!el) return value;
      const rect = el.getBoundingClientRect();
      const p = rect.width > 0 ? clamp((clientX - rect.left) / rect.width, 0, 1) : 0;
      const stepped = min + Math.round((p * (max - min)) / step) * step;
      return Number(clamp(stepped, min, max).toPrecision(12));
    },
    [min, max, step, value],
  );

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0) return;
    e.preventDefault();
    draggingRef.current = true;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* 捕获失败继续走元素事件 */
    }
    onValueChange(valueAt(e.clientX));
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    onValueChange(valueAt(e.clientX));
  };

  const onPointerEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    draggingRef.current = false;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* 未捕获时忽略 */
    }
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    let next: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") next = value + step;
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = value - step;
    else if (e.key === "Home") next = min;
    else if (e.key === "End") next = max;
    if (next == null) return;
    e.preventDefault();
    onValueChange(Number(clamp(next, min, max).toPrecision(12)));
  };

  const pct = max > min ? clamp((value - min) / (max - min), 0, 1) * 100 : 0;

  return (
    <div
      ref={rootRef}
      className={`gs-root${disabled ? " disabled" : ""}`}
      role="slider"
      aria-label={ariaLabel}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={Number(value.toPrecision(12))}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onKeyDown={onKeyDown}
    >
      <div className="gs-track">
        <div className="gs-range" style={{ width: `${pct}%` }} />
      </div>
      <div className="gs-thumb" style={{ left: `${pct}%` }} />
    </div>
  );
}
