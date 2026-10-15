// 栅格后端抽象（自包含渲染重构 Step 1：零行为变化的接缝）。
//
// 职责边界：调用方（renderLoop）只负责「采样语义」的时钟与失效（淡入插值、
// 复用窗口、bufGen 代数、贴回锚定）——这些是染色逻辑本身，一行不动；
// 本接口只回答「怎么把一个面板画进给定的两个画布（glow/dark）」。
//
// 当前后端 canvas2d = 现有 drawPanel 管线原样包装（超采样描边 + 离屏模糊带）。
// Step 2 的 WebGL 后端将替换为「解析式衰减剖面 + 静止条带 + LUT 颜色上传」，
// 到时本接口会演化为 per-target surface provider（直接产像素源），但语义层
// 依旧经由调用方的时钟/失效驱动。
import { drawPanel } from "./tint";
import type { LightSet } from "./primitives";

export interface TintRaster {
  readonly id: string;
  /** 将单个面板的 glow/dark 两层像素画入给定画布（内容锚定元素 rect）。 */
  drawPanel(
    el: HTMLElement,
    ctx2: CanvasRenderingContext2D,
    shadeCtx2: CanvasRenderingContext2D,
    cards: LightSet,
    frameScale: number,
  ): void;
}

export const canvas2dRaster: TintRaster = {
  id: "canvas2d",
  drawPanel(el, ctx2, shadeCtx2, cards, frameScale) {
    drawPanel(el, ctx2, shadeCtx2, cards, frameScale);
  },
};
