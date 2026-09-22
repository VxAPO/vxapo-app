import { useEffect, useRef, useState } from "react";
import { DEVICE_FADE_MS } from "../lib/viewMotion";
import { driveFor } from "../lib/edgetint/renderLoop";

/**
 * 设备切换的两段式过渡：**数据源滞后一拍**，保证"旧页完全淡出 → 换内容 → 新页淡入"。
 *
 * 只用 `AnimatePresence mode="wait"` 不够：它保证的是"元素"先退后进，而设备页内容是
 * store 驱动的——`selectedGuid` 一变，那个还在淡出的旧元素立刻渲染成新设备的数据，
 * 观感就是"旧页还在淡、新页的内容已经进来了"。把**数据**也滞后一个淡出时长，两段才真正
 * 串行；顺带页面元素不再按设备重挂载（染色 canvas 也不必重新登记目标）。
 *
 * 返回：
 * - `shown`：当前应渲染的设备（滞后 `selectedGuid` 一个淡出时长）；
 * - `opacity`：设备页的目标透明度（配 `.device-page` 的 transition 用）。
 */
export function useDeviceSwapFade(selectedGuid: string | null): {
  shown: string | null;
  opacity: number;
  /** 是否正处在"旧页淡出、尚未换数据"的窗口里（页面内容需要冻结旧值） */
  swapping: boolean;
} {
  const [shown, setShown] = useState(selectedGuid);
  const [opacity, setOpacity] = useState(1);
  const timer = useRef<number>(0);

  useEffect(() => {
    if (selectedGuid === shown) return;
    // 首次选中（null → 某设备）不做过渡：此时页面是空态，淡出没有意义
    if (shown === null) {
      setShown(selectedGuid);
      return;
    }
    setOpacity(0); // ① 旧设备数据淡出（内容不变，仍是旧页）
    driveFor(DEVICE_FADE_MS + 80, "full");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      // ② 换数据：此刻页面不可见，内容硬切不会被看到；同一提交里把透明度抬回 1，
      //    浏览器从当前计算值 0 过渡到 1 —— 新数据正好淡入一次。
      setShown(selectedGuid);
      setOpacity(1);
      driveFor(DEVICE_FADE_MS + 80, "full");
    }, DEVICE_FADE_MS);
    return () => window.clearTimeout(timer.current);
  }, [selectedGuid, shown]);

  return { shown, opacity, swapping: selectedGuid !== shown };
}

/**
 * 在 `hold` 期间冻结上一个值。
 *
 * 设备切换时页面内容要滞后一拍（旧页淡出期间仍显示旧设备的数据），但侧边栏、页签这类
 * "壳"必须即时响应——于是把页面用的值冻结，壳用实时值（两侧各自取用，互不牵制）。
 */
export function useFrozenWhile<T>(hold: boolean, value: T): T {
  const [frozen, setFrozen] = useState(value);
  useEffect(() => {
    if (!hold) setFrozen(value);
  }, [hold, value]);
  return hold ? frozen : value;
}
