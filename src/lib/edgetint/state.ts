// 边缘染色的模块级可变状态（决策 5 阶段 A 第四批）。
//
// 从 hooks/useEdgeTintLayer.ts 原样搬出、原样取名（行为零变化），只是收进一个对象：
// ESM 的导入绑定不可赋值——`let x` 搬到别的模块后 `x = …` 会直接报错，
// 只有对象属性（`ST.x = …`）才能被 tint / renderLoop / targets / canvasPool 共享。
import type { ColorSource, Rgb } from "./geometry";
import type { CardNode, InnerState } from "./primitives";

/** 一个画布面板的复用缓冲（原 `PanelBuffer`）。 */
export type PanelBuffer = {
  c: HTMLCanvasElement;
  k: CanvasRenderingContext2D;
  sc: HTMLCanvasElement;
  sk: CanvasRenderingContext2D;
  /** 上次完整渲染的时刻（复用窗口以它为基准）。 */
  at: number;
  /** 自上次完整渲染以来已连续复用的帧数。 */
  reused: number;
  x: number;
  y: number;
  w: number;
  h: number;
  dpr: number;
};

/** 模块级可变状态（字段与原 `let/const` 声明一一对应）。 */
export interface EdgeTintState {
  canvas: HTMLCanvasElement | null;
  ctx: CanvasRenderingContext2D | null;
  toolCanvas: HTMLCanvasElement | null;
  toolCtx: CanvasRenderingContext2D | null;
  shadeCanvas: HTMLCanvasElement | null;
  shadeCtx: CanvasRenderingContext2D | null;
  toolShadeCanvas: HTMLCanvasElement | null;
  toolShadeCtx: CanvasRenderingContext2D | null;
  prevBaseDirty: { x: number; y: number; w: number; h: number } | null;
  prevToolDirty: { x: number; y: number; w: number; h: number } | null;
  /** 上一次绘制时画布原点（视口坐标）：原点变化等于整块内容失效，必须重开画布。 */
  prevBaseOrigin: { x: number; y: number } | null;
  prevToolOrigin: { x: number; y: number } | null;
  softCanvas: HTMLCanvasElement | null;
  softCtx: CanvasRenderingContext2D | null;
  ssCanvas: HTMLCanvasElement | null;
  ssCtx: CanvasRenderingContext2D | null;
  panelBuffers: WeakMap<HTMLElement, PanelBuffer>;
  raf: number;
  running: boolean;
  themeObserver: MutationObserver | null;
  layoutObserver: MutationObserver | null;
  scrollIdleTimer: number;
  selectionTimer: number;
  themePaintTimer: number;
  viewAnimUntil: number;
  paintMode: "tool" | "full";
  scrollingNow: boolean;
  fadePending: boolean;
  autoScanTimer: number;
  autoMo: MutationObserver | null;
  autoScanRaf: number;
  autoStarted: boolean;
  targetRos: Map<HTMLElement, ResizeObserver>;
  targets: Set<HTMLElement>;
  colorCache: WeakMap<HTMLElement, { at: number; color: Rgb | null }>;
  host: HTMLElement | null;
  cardNodes: CardNode[] | null;
  curvePointCache: WeakMap<SVGPathElement, { key: string; pts: ColorSource[] }>;
  /** 每个采样点的平滑状态：alpha 独立逼近目标，颜色做插值。 */
  ringStates: WeakMap<HTMLElement, { a: number[]; r: number[]; g: number[]; b: number[] }>;
  innerStates: WeakMap<HTMLElement, InnerState>;
  scanSig: string;
  /** 已挂载的入口数量（见 useEdgeTintLayer 的引用计数说明）。 */
  autoRefCount: number;
}

/** 单例状态。 */
export const ST: EdgeTintState = {
  canvas: null,
  ctx: null,
  toolCanvas: null,
  toolCtx: null,
  shadeCanvas: null,
  shadeCtx: null,
  toolShadeCanvas: null,
  toolShadeCtx: null,
  prevBaseDirty: null,
  prevToolDirty: null,
  prevBaseOrigin: null,
  prevToolOrigin: null,
  softCanvas: null,
  softCtx: null,
  ssCanvas: null,
  ssCtx: null,
  panelBuffers: new WeakMap<HTMLElement, PanelBuffer>(),
  raf: 0,
  running: false,
  themeObserver: null,
  layoutObserver: null,
  scrollIdleTimer: 0,
  selectionTimer: 0,
  themePaintTimer: 0,
  viewAnimUntil: 0,
  paintMode: "full",
  scrollingNow: false,
  fadePending: false,
  autoScanTimer: 0,
  autoMo: null,
  autoScanRaf: 0,
  autoStarted: false,
  targetRos: new Map<HTMLElement, ResizeObserver>(),
  targets: new Set<HTMLElement>(),
  colorCache: new WeakMap<HTMLElement, { at: number; color: Rgb | null }>(),
  host: null,
  cardNodes: null,
  curvePointCache: new WeakMap<SVGPathElement, { key: string; pts: ColorSource[] }>(),
  ringStates: new WeakMap<HTMLElement, { a: number[]; r: number[]; g: number[]; b: number[] }>(),
  innerStates: new WeakMap<HTMLElement, InnerState>(),
  scanSig: "",
  autoRefCount: 0,
};
