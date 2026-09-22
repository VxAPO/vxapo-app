import { useEffect, useRef, useState } from "react";

/** 曲线等重计算的节流间隔（约 24fps）：拖动滑块时固定间隔重算 + 停止后补算一次。 */
export const THROTTLED_COMPUTE_MS = 42;

/**
 * 对依赖变化做固定间隔的延迟计算：rAF 链从最近一次计算结果计时，
 * 达到间隔才重算，变化停止后最多再补算一次；渲染侧用上一次结果（滞后一档）。
 */
export function useThrottledCompute<T>(
  compute: () => T,
  deps: unknown[],
  intervalMs = THROTTLED_COMPUTE_MS,
): T | null {
  const [result, setResult] = useState<T | null>(null);
  const computeRef = useRef(compute);
  computeRef.current = compute;
  // 跨 effect 重跑保持节流计时：局部变量会在每次依赖变化时归零导致失去节流。
  const lastComputeRef = useRef(-Infinity);

  useEffect(() => {
    let alive = true;
    let raf = 0;
    const run = () => {
      if (!alive) return;
      lastComputeRef.current = performance.now();
      setResult(computeRef.current());
    };
    const schedule = () => {
      if (!alive) return;
      if (performance.now() - lastComputeRef.current >= intervalMs) {
        run();
      } else {
        raf = requestAnimationFrame(schedule);
      }
    };
    raf = requestAnimationFrame(schedule);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return result;
}
