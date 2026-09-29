/**
 * 视图切换动效的共享常量与工具。
 *
 * 平移、高度收窄、滚动条长度变形三者必须同源：数值散落在各文件里迟早漂移，
 * 于是统一放这里。改这里的数字等于改时序契约（见 UI 设计规范 03/06）。
 * 曲线本身单源在 lib/motionEase.ts —— 卡片拖拽避让共用同一条，改一处即三处生效。
 */

import { EASE_OUT_SOFT, EASE_OUT_SOFT_P1, EASE_OUT_SOFT_P2 } from "./motionEase";

/** 视图平移动画时长（ms）；stage 的 transition 与收窄启动时刻共用 */
export const VIEW_SLIDE_MS = 320;
/** 设备页切换的淡出/淡入时长（ms，两段各自；AnimatePresence mode="wait" 先退后进）。
    0.18s 是拆分前一直用的值（两段合计 0.36s，观感自然不拖），改它等于改切换手感。 */
export const DEVICE_FADE_MS = 180;
/** 高度收窄动画时长上限（ms） */
export const VIEW_COLLAPSE_MS = 800;
/** 收窄时长的下限（ms）与按高度差的换算：差值越小收得越快 */
export const COLLAPSE_MS_MIN = 260;
export const COLLAPSE_MS_PER_PX = 2;
/** 小于这个高度差直接对齐、不播动画（这点位移肉眼看不出来） */
export const COLLAPSE_SNAP_PX = 4;
/** 收窄与滚动条变形共用曲线（先快后慢）；与拖拽避让 LAYOUT_EASE 同源（lib/motionEase.ts） */
export const COLLAPSE_EASE = EASE_OUT_SOFT;
/** 上面那条曲线的控制点，供 JS 侧求值（两者必须一致） */
const EASE_P1 = EASE_OUT_SOFT_P1;
const EASE_P2 = EASE_OUT_SOFT_P2;

/** 高度差 → 动画时长：夹在 [COLLAPSE_MS_MIN, VIEW_COLLAPSE_MS] 之间 */
export function heightDeltaMs(deltaPx: number): number {
  return Math.round(
    Math.min(
      VIEW_COLLAPSE_MS,
      Math.max(COLLAPSE_MS_MIN, Math.abs(deltaPx) * COLLAPSE_MS_PER_PX),
    ),
  );
}

const bez = (a: number, b: number, t: number) => {
  // 三次贝塞尔：P0=0，P3=1
  const u = 1 - t;
  return 3 * u * u * t * a + 3 * u * t * t * b + t * t * t;
};

/** COLLAPSE_EASE 在 t∈[0,1] 上的值（牛顿迭代 + 二分兜底） */
export function collapseEase(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  let x = t;
  for (let i = 0; i < 8; i++) {
    const dx = bez(EASE_P1.x, EASE_P2.x, x) - t;
    if (Math.abs(dx) < 1e-5) break;
    const d = 3 * (1 - x) * (1 - x) * EASE_P1.x +
      6 * (1 - x) * x * (EASE_P2.x - EASE_P1.x) +
      3 * x * x * (1 - EASE_P2.x);
    if (d < 1e-6) break;
    x = Math.min(1, Math.max(0, x - dx / d));
  }
  return bez(EASE_P1.y, EASE_P2.y, x);
}
