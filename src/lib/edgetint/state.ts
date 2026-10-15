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
  /**
   * 本帧的贴回（blit）位置：始终取元素**当前** rect 推出的视口坐标。
   * 缓冲像素以元素自身 rect 为基准绘制（见 renderToPanelBuffer 的 transform），
   * 内容对元素是「锚定」的——元素平移后按当前位置贴回即对齐，因此复用
   * 不再要求位置与渲染时一致（动画/滚动期间复用窗口才能真正命中）。
   */
  x: number;
  y: number;
  w: number;
  h: number;
  dpr: number;
  /** 渲染时的结构代数（ST.bufGen）：代数不同禁止复用（配色源集合已变）。 */
  gen: number;
};

/** 单次 paint 内的元素样式缓存（paint() 入口整体清空；同一帧内 DOM 不变，读数安全）。 */
export interface PaintCacheEntry {
  /** targetVisibility 的缓存值：同一帧内多次调用只算一次。 */
  vis?: number;
  /** panelBaseLum 的缓存值：含 querySelector + 多段样式读取，每帧每面板只算一次。 */
  baseLum?: number;
}

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
  /** 工具栏画布的逐帧重绘截止时刻（工具栏淡入淡出期间由 driveFor 推着走） */
  toolAnimUntil: number;
  paintMode: "tool" | "full";
  scrollingNow: boolean;
  fadePending: boolean;
  /**
   * 结构代数：卡片增减/视图舞台切换等配色源集合变化时 +1。
   * 面板缓冲记录渲染时的代数，代数不同禁止复用——放宽复用窗口后
   * 防止「结构已变、旧配色滞留」。
   */
  bufGen: number;
  /** 本次 paint 的元素样式缓存（paint() 入口清空）。 */
  paintCache: Map<HTMLElement, PaintCacheEntry>;
  /** 本次 paint 的 getComputedStyle 缓存（同一帧内 DOM 不变）。 */
  csCache: Map<HTMLElement, CSSStyleDeclaration>;
  /** 本次 paint 的根级取色缓存（--edge-shade/--ring-base 解析结果）。 */
  rootColorCache: Map<string, Rgb | null>;
  /** 上一次真正执行 paint 的时刻（fadePending 续帧的最小间隔保护）。 */
  lastPaintAt: number;
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
  ringStates: WeakMap<
    HTMLElement,
    { a: number[]; r: number[]; g: number[]; b: number[] }
  >;
  innerStates: WeakMap<HTMLElement, InnerState>;
  scanSig: string;
  /** 已挂载的入口数量（见 useEdgeTintLayer 的引用计数说明）。 */
  autoRefCount: number;
  /** 归因埋点（perf 分支）：耗时统计，经 window.__vxTint 供 CDP 采样。 */
  stats: TintStats;
  /**
   * 各层最近一次全量重画的时间戳：paintLayerPair 的"内容未变跳过"判据——
   * 本 paint 开始后该层没有发生过全量重画（且无淡入淡出、脏区未动）⇒ 层像素
   * 与上帧完全一致，跳过 clear+重贴（不向 GPU 重传未变纹理）。
   */
  lastFullRender: { base: number; tool: number };
}

/**
 * 尖峰归因统计：paint = 一帧染色流水线总耗时（JS 侧）；drawPanel = 单个面板
 * 全量重画（含超采样+模糊）；blur = drawPanel 内全部 ctx.filter 模糊合计。
 * sum/count 供外部做窗口差分，last 供逐帧配对（帧间隔 vs 同帧 paint 耗时）。
 * 判据：帧间隔尖峰若与 paintLast 同帧同量级 → JS 侧；paintLast 很小而帧间隔
 * 大 → 合成/混合层（GPU/合成器）侧。
 */
export interface TintStats {
  paintLast: number;
  drawLast: number;
  blurLast: number;
  paints: number;
  draws: number;
  paintSum: number;
  drawSum: number;
  blurSum: number;
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
  toolAnimUntil: 0,
  paintMode: "full",
  scrollingNow: false,
  fadePending: false,
  bufGen: 1,
  paintCache: new Map<HTMLElement, PaintCacheEntry>(),
  csCache: new Map<HTMLElement, CSSStyleDeclaration>(),
  rootColorCache: new Map(),
  lastPaintAt: 0,
  autoScanTimer: 0,
  autoMo: null,
  autoScanRaf: 0,
  autoStarted: false,
  targetRos: new Map<HTMLElement, ResizeObserver>(),
  targets: new Set<HTMLElement>(),
  colorCache: new WeakMap<HTMLElement, { at: number; color: Rgb | null }>(),
  host: null,
  cardNodes: null,
  curvePointCache: new WeakMap<
    SVGPathElement,
    { key: string; pts: ColorSource[] }
  >(),
  ringStates: new WeakMap<
    HTMLElement,
    { a: number[]; r: number[]; g: number[]; b: number[] }
  >(),
  innerStates: new WeakMap<HTMLElement, InnerState>(),
  scanSig: "",
  autoRefCount: 0,
  lastFullRender: { base: 0, tool: 0 },
  stats: {
    paintLast: 0,
    drawLast: 0,
    blurLast: 0,
    paints: 0,
    draws: 0,
    paintSum: 0,
    drawSum: 0,
    blurSum: 0,
  },
};

/**
 * 同一帧内的 getComputedStyle 缓存：paint() 入口整体清空。
 * 动画期间 framer-motion 每帧写 style，染色循环再逐帧读样式会互相强制重算；
 * 同一帧内 DOM 不变，重复读取没有信息量，缓存即可。
 */
export function csOf(el: HTMLElement): CSSStyleDeclaration {
  let cs = ST.csCache.get(el);
  if (!cs) {
    cs = getComputedStyle(el);
    ST.csCache.set(el, cs);
  }
  return cs;
}

/**
 * 同一帧内的元素级 paint 缓存（可见度/面板底色等复合读数）。
 * Map 不存在或缺少该元素时创建条目；调用方在 paint() 入口无需逐项清理。
 */
export function paintEntryOf(el: HTMLElement): PaintCacheEntry {
  let e = ST.paintCache.get(el);
  if (!e) {
    e = {};
    ST.paintCache.set(el, e);
  }
  return e;
}

/**
 * 同一帧内的根级取色缓存（--edge-shade/--ring-base 等解析结果）：
 * 原实现每个面板各读一次根 computed style，一帧 N 个面板就是 2N 次根样式读取。
 */
export function rootColorCached<T extends Rgb | null>(
  key: string,
  read: () => T,
): T {
  const cache = ST.rootColorCache;
  if (cache.has(key)) return cache.get(key) as T;
  const v = read();
  cache.set(key, v);
  return v;
}
