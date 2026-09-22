import { useEffect, useRef, useState } from "react";

/** 曲线等重计算的节流间隔（约 24fps）：拖动滑块时固定间隔重算 + 停止后补算一次。 */
export const THROTTLED_COMPUTE_MS = 42;

/**
 * 对依赖变化做固定间隔的延迟计算：rAF 链从最近一次计算结果计时，
 * 达到间隔才重算，变化停止后最多再补算一次；渲染侧用上一次结果（滞后一档）。
 *
 * **孤立变化立即计算**：距上一次变化已超过一个间隔时（切声道、增删段、切设备、切视图），
 * 没有"连续流"要保帧率，直接算——否则切换会先显示旧结果、一两帧后才跳，观感是"突兀"。
 * 只有连续变化（拖滑块）才走节流。
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
  /** 上一次依赖变化的时刻（判断本次是孤立变化还是连续流的一员） */
  const lastChangeRef = useRef(-Infinity);

  useEffect(() => {
    let alive = true;
    let raf = 0;
    const run = () => {
      if (!alive) return;
      lastComputeRef.current = performance.now();
      setResult(computeRef.current());
    };
    // 孤立变化：直接算，不排 rAF（切声道/切设备这类一次性操作要跟上手）
    const now = performance.now();
    const isolated = now - lastChangeRef.current > intervalMs;
    lastChangeRef.current = now;
    if (isolated) {
      run();
      return;
    }
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
