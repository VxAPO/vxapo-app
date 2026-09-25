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

/**
 * 切换时卡片的错峰淡入（左上 → 右下）。
 *
 * 延迟在**开播前**一次算好（不是「等上一张跑完再跑下一张」——那是串行，卡片会一个一个地
 * 往外蹦）。全部延迟先布好、动画互相重叠，只有起跑时刻错开。
 *
 * 排序按**对角线**：权重 = 行号 + 列号，同一反对角线上的卡片同时刻起跑，所以推进方向是
 * 沿对角线从左上扫到右下（行主序会让第二行第一列排在第一行最后一列之后，方向就不对了）。
 *
 * 间隔**前疏后密**：延迟 = 窗口 × √(权重 / 最大权重)（开方曲线，斜率递减）。越靠后越晚起跑，
 * 但两点之间的间隔越来越小——头几张拉得开、尾段快速收束。用线性会让整队匀速铺开，观感偏"排队"。
 *
 * 张数多时靠 `STAGGER_WINDOW_MS` + `STAGGER_STEP_MS` 自适应窗口（见下），
 * 而不是「延迟封顶」：封顶会把超出窗口的卡片挤到同一时刻，断掉「越远越晚」的顺序（踩过）。
 */
/** 最近（左上角）那张的单张落位时长：最长，位移看得最完整 */
export const STAGGER_FADE_NEAR_MS = 260;
/** 最远那张的单张落位时长：最短，尾部收束时短促带过 */
export const STAGGER_FADE_FAR_MS = 150;
/** 权重单位的时间上限：窗口 = min(`STAGGER_WINDOW_MS`, 最大权重 × 它)，张数少时窗口跟着小 */
export const STAGGER_STEP_MS = 14;
/** 错峰窗口上限：最后一张的延迟不超过它 */
export const STAGGER_WINDOW_MS = 200;
/** 落位前的起手位移（px）：卡片从上方这么远处落下来（配合 `EASE_OUT_BACK` 过冲回弹）。
    注意方向——卡片起始在**上方**，是"往下展"；写成正值就成了"从下方往上收"（曾如此）。
    0 = 纯淡入。 */
export const STAGGER_DROP_PX = 6;
/** 排序行容差：top 差在此以内视为同一行、行内按 left 排 */
export const STAGGER_ROW_TOL_PX = 8;

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
