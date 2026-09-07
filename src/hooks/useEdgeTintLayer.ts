import { useEffect, type RefObject } from "react";

/**
 * 外部 Canvas 环带染色层：
 * - 设备卡/曲线卡画在低层（z25），悬浮工具栏自己的环带画在高层（z35）。
 * - 暗部不再单独画黑线：shade 控制内光在该处“留空”（lit=0），
 *   让底层默认高光样式的暗部自己透出来，内光弱的地方暗部自然更弱。
 * 颜色只来自卡片真正带主题色的部分（描边/chip/圆点），黑白区域不掺色相。
 */

type Rgb = { r: number; g: number; b: number };
type ColorSource = {
  r: DOMRect;
  color: Rgb;
  /** 卡片内容里的内部光源（chip/圆点），不是外圈描边 */
  inner?: boolean;
  /** 整张卡片只算描边一圈；内部空白不算色源 */
  border?: boolean;
  /** 光源强度倍率：框选后描边加粗，作为光源更亮/权重更大 */
  power?: number;
};

type LumSource = {
  r: DOMRect;
  lum: number;
  /** 只在玻璃内部、会被面板模糊的内容；外圈高光/徽标不是内光光源 */
  inner?: boolean;
  /** 边框光源：点到整卡边框内侧距离；普通表面按点到矩形距离 */
  border?: boolean;
  power?: number;
};

type LightSet = {
  colors: ColorSource[];
  lums: LumSource[];
  /** 曲线 SVG 路径的离散点光源，用于影响更高层工具栏 */
  curve: ColorSource[];
};

let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let toolCanvas: HTMLCanvasElement | null = null;
let toolCtx: CanvasRenderingContext2D | null = null;
let prevBaseDirty: { x: number; y: number; w: number; h: number } | null =
  null;
let prevToolDirty: { x: number; y: number; w: number; h: number } | null =
  null;
let lowData: Uint8ClampedArray | null = null;
let lowDataW = 0;
let lowDataH = 0;
let lowDataDpr = 1;
let softCanvas: HTMLCanvasElement | null = null;
let softCtx: CanvasRenderingContext2D | null = null;
let ssCanvas: HTMLCanvasElement | null = null;
let ssCtx: CanvasRenderingContext2D | null = null;
type PanelBuffer = {
  c: HTMLCanvasElement;
  k: CanvasRenderingContext2D;
  x: number;
  y: number;
  w: number;
  h: number;
  dpr: number;
};
const panelBuffers = new WeakMap<HTMLElement, PanelBuffer>();
let raf = 0;
let running = false;
let themeObserver: MutationObserver | null = null;
let layoutObserver: MutationObserver | null = null;
let scrollIdleTimer = 0;
let selectionTimer = 0;
let paintMode: "tool" | "full" = "full";
let fadePending = false;
let autoScanTimer = 0;
let autoMo: MutationObserver | null = null;
let autoStarted = false;
const targetRos = new Map<HTMLElement, ResizeObserver>();
const targets = new Set<HTMLElement>();
let colorCache = new WeakMap<HTMLElement, { at: number; color: Rgb | null }>();
let host: HTMLElement | null = null;
type CardNode = { el: HTMLElement; accents: HTMLElement[] };
let cardNodes: CardNode[] | null = null;

function refreshCardNodes(): CardNode[] {
  cardNodes = [...document.querySelectorAll<HTMLElement>("[data-dnd-id]")].map(
    (el) => ({
      el,
      accents: [
        ...el.querySelectorAll<HTMLElement>(
          ".sem-chip, .enable-dot.on, .effect-dot.on",
        ),
      ],
    }),
  );
  return cardNodes;
}

const curvePointCache = new WeakMap<
  SVGPathElement,
  { key: string; pts: ColorSource[] }
>();

function curvePointSources(): ColorSource[] {
  const path = document.querySelector<SVGPathElement>(
    ".fx-curve svg path[stroke]",
  );
  if (!path) return [];
  const rect = path.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return [];
  const key = `${rect.width.toFixed(1)}|${rect.height.toFixed(1)}|${
    path.getAttribute("d")?.length ?? 0
  }`;
  const hit = curvePointCache.get(path);
  if (hit && hit.key === key) return hit.pts;
  const cs = getComputedStyle(path);
  const color =
    parseColor(cs.stroke) ||
    parseColor(
      getComputedStyle(document.documentElement)
        .getPropertyValue("--curve-path")
        .trim(),
    ) ||
    (isDark() ? { r: 71, g: 195, b: 209 } : { r: 0, g: 154, b: 162 });
  const ctm = path.getScreenCTM();
  if (!ctm) return [];
  const pts: ColorSource[] = [];
  const len = path.getTotalLength();
  const STEP = 16;
  for (let d = 0; d <= len; d += STEP) {
    const p = path.getPointAtLength(Math.min(len, d));
    const s = p.matrixTransform(ctm);
    pts.push({
      r: new DOMRect(s.x - 1, s.y - 1, 2, 2),
      color,
      power: 0.9,
      inner: true,
    });
  }
  curvePointCache.set(path, { key, pts });
  return pts;
}

const SAMPLE_R = 32;
const INNER_SAMPLE_R = 16;
const MAX_POWER = 2.4;
const MAX_SOURCE_R = Math.ceil(SAMPLE_R * Math.sqrt(MAX_POWER));
const RING_STEP = 8;
const ARC_STEP = 1.5;
const LINE_W = 2;
const LINE_ALPHA = 0.3;
const FADE_K = 0.3;
const COLOR_K = 0.4;
const SHADE_WINDOW_R = 12;
const SHADE_SMOOTH_R = 4;
const SHADE_OUT_SMOOTH_R = 8;
const MENISCUS_INSET = 2;
const MENISCUS_WIDTH = 3;
const MENISCUS_ALPHA = 0.22;
const MENISCUS_BLUR = 1.2;
const MENISCUS_HALO_WIDTH = 8;
const MENISCUS_HALO_ALPHA = 0.18;
const MENISCUS_HALO_BLUR = 4;
const Z_BASE = 25;
const Z_TOOL = 35;

function makeLayer(z: number): {
  c: HTMLCanvasElement;
  k: CanvasRenderingContext2D;
} | null {
  const c = document.createElement("canvas");
  c.style.cssText =
    `position:fixed;left:0;top:0;pointer-events:none;z-index:${z};mix-blend-mode:screen;`;
  const k = c.getContext("2d");
  if (!k) {
    c.remove();
    return null;
  }
  (host ?? document.body).appendChild(c);
  return { c, k };
}

function ensureCanvas(h: HTMLElement | null = null): void {
  if (h) host = h;
  if (!host) host = document.body;
  const mount = host.isConnected ? host : document.body;
  if (canvas && canvas.parentElement !== mount) mount.appendChild(canvas);
  if (toolCanvas && toolCanvas.parentElement !== mount) {
    mount.appendChild(toolCanvas);
  }
  if (canvas && ctx && toolCanvas && toolCtx) return;
  const base = canvas && ctx ? null : makeLayer(Z_BASE);
  const tool = toolCanvas && toolCtx ? null : makeLayer(Z_TOOL);
  if (base) {
    canvas = base.c;
    ctx = base.k;
  }
  if (tool) {
    toolCanvas = tool.c;
    toolCtx = tool.k;
  }
}

function parseColor(s: string): Rgb | null {
  const v = s.trim().toLowerCase();
  let m = /^#([0-9a-f]{6})$/.exec(v);
  if (m) {
    const n = parseInt(m[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  m = /^#([0-9a-f]{3})$/.exec(v);
  if (m) {
    const n = parseInt(m[1], 16);
    return {
      r: ((n >> 8) & 15) * 17,
      g: ((n >> 4) & 15) * 17,
      b: (n & 15) * 17,
    };
  }
  const rgb = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(v);
  if (rgb) {
    return { r: +rgb[1], g: +rgb[2], b: +rgb[3] };
  }
  return null;
}

function isDark(): boolean {
  return document.documentElement.dataset.theme === "dark";
}

function rgbLuminance(c: Rgb): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

/** 取元素实际表面亮度；透明背景回退主题卡片色 */
function surfaceLumOf(el: HTMLElement): number | null {
  const cs = getComputedStyle(el);
  const bgValue = cs.backgroundColor.trim();
  if (bgValue && bgValue !== "transparent") {
    const alphaM = /^rgba?\(\s*[\d.]+[,\s]+[\d.]+[,\s]+[\d.]+(?:[,\s/]+([\d.]+(?:%?)))?/i.exec(
      bgValue,
    );
    const alpha = alphaM?.[1] != null ? parseFloat(alphaM[1]) / (alphaM[1].includes("%") ? 100 : 1) : 1;
    if (alpha >= 0.2) {
      const bg = parseColor(bgValue);
      if (bg) return rgbLuminance(bg);
    }
  }
  for (const key of ["--card", "--content", "--surface-inset"]) {
    const c = parseColor(cs.getPropertyValue(key).trim());
    if (c) return rgbLuminance(c);
  }
  return null;
}

function panelBaseLum(el: HTMLElement): number {
  const inner = el.querySelector<HTMLElement>(
    ".curve-wrap, .dev-props-card, .sel-toolbar",
  );
  if (inner) {
    const lum = surfaceLumOf(inner);
    if (lum != null) return lum;
  }
  const root = getComputedStyle(document.documentElement);
  const c = parseColor(root.getPropertyValue("--card").trim());
  if (c) return rgbLuminance(c);
  return isDark() ? 28 : 247;
}

function cardColor(el: HTMLElement): Rgb | null {
  const hit = colorCache.get(el);
  if (hit && performance.now() - hit.at < 500) return hit.color;
  const cs = getComputedStyle(el);
  const darkKey = "--card-accent-dark";
  const lightKey = "--card-accent";
  const accent =
    cs.getPropertyValue(isDark() ? darkKey : lightKey).trim() ||
    cs.getPropertyValue(lightKey).trim();
  const color =
    parseColor(accent) ||
    (el.dataset.dndGroup === "effects"
      ? parseColor(cs.getPropertyValue("--brand").trim())
      : null);
  colorCache.set(el, { at: performance.now(), color });
  return color;
}

function distToRect(x: number, y: number, r: DOMRect): number {
  const dx = Math.max(r.left - x, 0, x - r.right);
  const dy = Math.max(r.top - y, 0, y - r.bottom);
  return Math.hypot(dx, dy);
}

/** 卡片描边：点在卡内时只算到最近描边的距离，卡中心空白不等于 0。 */
function distToBorder(x: number, y: number, r: DOMRect): number {
  const inside =
    x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  if (!inside) return distToRect(x, y, r);
  return Math.min(x - r.left, r.right - x, y - r.top, r.bottom - y);
}

type EdgeSample = { c: Rgb; s: number } | null;

/** 距离主导的加权混色 + 强度：越近 alpha 越高，远处自然淡出。 */
function sampleColor(
  x: number,
  y: number,
  sources: ColorSource[],
  radius: number,
  radiusFor?: (r: DOMRect) => number,
): EdgeSample {
  let wSum = 0;
  let r = 0;
  let g = 0;
  let b = 0;
  for (const c of sources) {
    const d = c.border ? distToBorder(x, y, c.r) : distToRect(x, y, c.r);
    // 光源半径随强度缩放：徽标 2.4 -> 约 1.55 倍基础半径，框选次之，默认最短
    const p = c.power ?? 1;
    const sr =
      radius * Math.sqrt(p) * (radiusFor ? radiusFor(c.r) : 1);
    if (d >= sr) continue;
    const w = Math.pow(1 - d / sr, 2) * p;
    if (w <= 0) continue;
    wSum += w;
    r += c.color.r * w;
    g += c.color.g * w;
    b += c.color.b * w;
  }
  if (wSum <= 0) return null;
  // 光源等级：数字徽标 > 框选描边 > 默认描边；上限放开到 2.4 保留梯度
  return { c: { r: r / wSum, g: g / wSum, b: b / wSum }, s: Math.min(2.4, wSum) };
}

function sampleLum(
  x: number,
  y: number,
  sources: LumSource[],
  radius: number,
  radiusFor?: (r: DOMRect) => number,
): { lum: number; prox: number } | null {
  let wSum = 0;
  let lum = 0;
  for (const s of sources) {
    const d = s.border ? distToBorder(x, y, s.r) : distToRect(x, y, s.r);
    const p = s.power ?? 1;
    const sr =
      radius * Math.sqrt(p) * (radiusFor ? radiusFor(s.r) : 1);
    if (d >= sr) continue;
    const w = Math.pow(1 - d / sr, 2) * p;
    if (w <= 0) continue;
    wSum += w;
    lum += s.lum * w;
  }
  if (wSum <= 0) return null;
  return { lum: lum / wSum, prox: Math.min(1, wSum / 1.2) };
}

function rgba(c: Rgb, a: number): string {
  return `rgba(${c.r | 0},${c.g | 0},${c.b | 0},${Math.max(0, Math.min(1, a))})`;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** 暗部凸起：以“离局部峰值的路径距离”为自变量。
 *  0~3px 完全无暗部（光源紧贴时留空），3~5px 缓入，
 *  5px 处最强，5~10px 缓出，10px 外归 0。 */
function shadeBumpAt(d: number): number {
  const MIN_R = 3;
  const PEAK_R = 5;
  const ZERO_R = 10;
  if (d <= MIN_R || d >= ZERO_R) return 0;
  if (d < PEAK_R) return smoothstep(MIN_R, PEAK_R, d);
  return 1 - smoothstep(PEAK_R, ZERO_R, d);
}

type RingPoint = { x: number; y: number; brk?: boolean };

/** 沿圆角矩形路径生成连续采样点，并用 brk 标记每条直边/圆角起点。 */
function ringPoints(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  rc: number,
): Array<RingPoint> {
  const pts: Array<RingPoint> = [];
  const addLine = (
    ax: number,
    ay: number,
    bx: number,
    by: number,
    brk: boolean,
  ) => {
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 0.5) return;
    const n = Math.max(1, Math.ceil(len / RING_STEP));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      pts.push({
        x: ax + (bx - ax) * t,
        y: ay + (by - ay) * t,
        brk: brk && i === 0,
      });
    }
  };
  const addArc = (
    cx: number,
    cy: number,
    a0: number,
    a1: number,
    brk: boolean,
  ) => {
    const span = Math.abs(a1 - a0);
    const len = span * rc;
    if (len < 0.5) return;
    const n = Math.max(1, Math.ceil(len / ARC_STEP));
    for (let i = 0; i < n; i++) {
      const a = a0 + (a1 - a0) * (i / n);
      pts.push({
        x: cx + Math.cos(a) * rc,
        y: cy + Math.sin(a) * rc,
        brk: brk && i === 0,
      });
    }
  };

  addArc(x0 + rc, y0 + rc, Math.PI, Math.PI * 1.5, true);
  addLine(x0 + rc, y0, x1 - rc, y0, true);
  addArc(x1 - rc, y0 + rc, Math.PI * 1.5, Math.PI * 2, true);
  addLine(x1, y0 + rc, x1, y1 - rc, true);
  addArc(x1 - rc, y1 - rc, 0, Math.PI * 0.5, true);
  addLine(x1 - rc, y1, x0 + rc, y1, true);
  addArc(x0 + rc, y1 - rc, Math.PI * 0.5, Math.PI, true);
  addLine(x0, y1 - rc, x0, y0 + rc, true);
  return pts;
}

/** 每个采样点的平滑状态：alpha 独立逼近目标，颜色做插值。 */
const ringStates = new WeakMap<
  HTMLElement,
  {
    a: number[];
    r: number[];
    g: number[];
    b: number[];
  }
>();

type InnerState = {
  gl: number[];
  sh: number[];
  ir: number[];
  ig: number[];
  ib: number[];
};

const innerStates = new WeakMap<HTMLElement, InnerState>();

function stateForRing(el: HTMLElement, n: number) {
  let st = ringStates.get(el);
  if (!st || st.a.length !== n) {
    st = {
      a: new Array(n).fill(0),
      r: new Array(n).fill(128),
      g: new Array(n).fill(128),
      b: new Array(n).fill(128),
    };
    ringStates.set(el, st);
  }
  return st;
}

function stateForInner(el: HTMLElement, n: number): InnerState {
  let st = innerStates.get(el);
  if (!st || st.gl.length !== n) {
    st = {
      gl: new Array(n).fill(0),
      sh: new Array(n).fill(0),
      ir: new Array(n).fill(255),
      ig: new Array(n).fill(255),
      ib: new Array(n).fill(255),
    };
    innerStates.set(el, st);
  }
  return st;
}

function panelRectsForTool(): DOMRect[] {
  return [...document.querySelectorAll<HTMLElement>(".fx-curve, .fx-dev")]
    .map((el) => el.getBoundingClientRect())
    .filter((r) => r.width > 2 && r.height > 2);
}

function syncLowCache(): void {
  if (!canvas || !ctx) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.width;
  const h = canvas.height;
  try {
    const img = ctx.getImageData(0, 0, w, h);
    lowData = img.data;
    lowDataW = w;
    lowDataH = h;
    lowDataDpr = dpr;
  } catch {
    lowData = null;
  }
}

/** 从低层 Canvas 读设备/曲线卡环带颜色（屏幕坐标）。 */
function sampleLowLayer(x: number, y: number): EdgeSample {
  if (!canvas || !ctx) return null;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const px = Math.max(2, Math.min((lowDataW || canvas.width) - 3, Math.round(x * (lowDataDpr || dpr))));
  const py = Math.max(2, Math.min((lowDataH || canvas.height) - 3, Math.round(y * (lowDataDpr || dpr))));
  let ta = 0;
  let tr = 0;
  let tg = 0;
  let tb = 0;
  if (lowData) {
    for (let oy = -2; oy <= 2; oy++) {
      for (let ox = -2; ox <= 2; ox++) {
        const i = ((py + oy) * lowDataW + (px + ox)) * 4;
        const a = lowData[i + 3];
        if (a <= 0) continue;
        ta += a;
        tr += lowData[i] * a;
        tg += lowData[i + 1] * a;
        tb += lowData[i + 2] * a;
      }
    }
  } else {
    try {
      const data = ctx.getImageData(px - 2, py - 2, 5, 5).data;
      for (let i = 0; i < data.length; i += 4) {
        const a = data[i + 3];
        if (a <= 0) continue;
        ta += a;
        tr += data[i] * a;
        tg += data[i + 1] * a;
        tb += data[i + 2] * a;
      }
    } catch {
      return null;
    }
  }
  const avg = ta / (255 * 25);
  if (avg < 0.02) return null;
  return {
    c: { r: tr / ta, g: tg / ta, b: tb / ta },
    // 归一化到和 DOM 采样相同的强度空间，保留徽标 > 框选 > 描边的亮度差
    s: Math.min(2.4, avg / LINE_ALPHA),
  };
}

function insetRing(
  rect: DOMRect,
  corner: number,
  inset: number,
): Array<RingPoint> {
  const rad = Math.max(0.5, corner - inset);
  return ringPoints(
    rect.left + inset,
    rect.top + inset,
    rect.right - inset,
    rect.bottom - inset,
    rad,
  );
}

function strokeChunkBand(
  bandCtx: CanvasRenderingContext2D,
  pts: Array<RingPoint>,
  lineWidth: number | ((i: number) => number),
  alphaAt: (i: number) => number,
  colorAt: (i: number) => Rgb,
  toolFade: number,
): void {
  if (pts.length < 2) return;
  const segs = pts.length - 1;
  // 以 ringPoints 的 brk 标记切段：每条直边/圆角各一段。
  // 圆角不会被切成两截，直边也可以一段画完（直线渐变是精确的）。
  let start = 0;
  while (start < segs) {
    let end = segs;
    for (let j = start + 1; j < segs; j++) {
      if (pts[j].brk) {
        end = j;
        break;
      }
    }
    if (end <= start) {
      start += 1;
      continue;
    }
    let has = false;
    for (let i = start; i <= end; i++) {
      if (alphaAt(i) > 0.003) {
        has = true;
        break;
      }
    }
    if (!has) {
      start = end;
      continue;
    }
    const grad = bandCtx.createLinearGradient(
      pts[start].x,
      pts[start].y,
      pts[end].x,
      pts[end].y,
    );
    for (let i = start; i <= end; i++) {
      const t = (i - start) / Math.max(1, end - start);
      const a = alphaAt(i) * toolFade;
      grad.addColorStop(
        Math.min(1, Math.max(0, t)),
        rgba(colorAt(i), Math.max(0, Math.min(1, a))),
      );
    }
    bandCtx.strokeStyle = grad;
    let w: number;
    if (typeof lineWidth === "function") {
      let sum = 0;
      for (let i = start; i <= end; i++) sum += lineWidth(i);
      w = Math.max(0.1, sum / (end - start + 1));
    } else {
      w = lineWidth;
    }
    bandCtx.lineWidth = w;
    bandCtx.lineCap = "butt";
    bandCtx.lineJoin = "round";
    bandCtx.beginPath();
    bandCtx.moveTo(pts[start].x, pts[start].y);
    for (let i = start + 1; i <= end; i++) {
      bandCtx.lineTo(pts[i].x, pts[i].y);
    }
    bandCtx.stroke();
    start = end;
  }
}

function ensureSoftCanvas(w: number, h: number): void {
  const needW = Math.max(1, Math.ceil(w));
  const needH = Math.max(1, Math.ceil(h));
  if (!softCanvas) {
    softCanvas = document.createElement("canvas");
    softCtx = softCanvas.getContext("2d");
    if (!softCtx) {
      softCanvas.remove();
      softCanvas = null;
      softCtx = null;
      return;
    }
  }
  if (softCanvas.width < needW || softCanvas.height < needH) {
    softCanvas.width = Math.max(softCanvas.width, needW);
    softCanvas.height = Math.max(softCanvas.height, needH);
  }
}

function ensureSsCanvas(w: number, h: number): void {
  if (!ssCanvas) {
    ssCanvas = document.createElement("canvas");
    ssCtx = ssCanvas.getContext("2d");
    if (!ssCtx) {
      ssCanvas.remove();
      ssCanvas = null;
      ssCtx = null;
      return;
    }
  }
  if (ssCanvas.width < w || ssCanvas.height < h) {
    ssCanvas.width = Math.max(ssCanvas.width, Math.ceil(w));
    ssCanvas.height = Math.max(ssCanvas.height, Math.ceil(h));
  }
}

function strokeHighQualityBand(
  bandCtx: CanvasRenderingContext2D,
  pts: Array<RingPoint>,
  lineWidth: number | ((i: number) => number),
  alphaAt: (i: number) => number,
  colorAt: (i: number) => Rgb,
  toolFade: number,
): void {
  if (pts.length < 2) return;
  const SCALE = 3;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  const PAD = 8;
  const ox = Math.floor(minX - PAD);
  const oy = Math.floor(minY - PAD);
  const ow = Math.ceil(maxX - minX + PAD * 2);
  const oh = Math.ceil(maxY - minY + PAD * 2);
  ensureSsCanvas(ow * SCALE, oh * SCALE);
  if (!ssCanvas || !ssCtx) {
    strokeChunkBand(bandCtx, pts, lineWidth, alphaAt, colorAt, toolFade);
    return;
  }
  ssCtx.setTransform(1, 0, 0, 1, 0, 0);
  ssCtx.clearRect(0, 0, ssCanvas.width, ssCanvas.height);
  ssCtx.setTransform(SCALE, 0, 0, SCALE, -ox * SCALE, -oy * SCALE);
  strokeChunkBand(ssCtx, pts, lineWidth, alphaAt, colorAt, toolFade);
  const smoothing = bandCtx.imageSmoothingEnabled;
  bandCtx.imageSmoothingEnabled = true;
  bandCtx.imageSmoothingQuality = "high";
  bandCtx.drawImage(
    ssCanvas,
    0,
    0,
    ow * SCALE,
    oh * SCALE,
    ox,
    oy,
    ow,
    oh,
  );
  bandCtx.imageSmoothingEnabled = smoothing;
}

function strokeGlowBand(
  bandCtx: CanvasRenderingContext2D,
  pts: Array<RingPoint>,
  lineWidth: number | ((i: number) => number),
  blurPx: number,
  alphaAt: (i: number) => number,
  colorAt: (i: number) => Rgb,
  toolFade: number,
): void {
  if (pts.length < 2) return;
  if (blurPx <= 0.2) {
    strokeChunkBand(bandCtx, pts, lineWidth, alphaAt, colorAt, toolFade);
    return;
  }
  // 先无 blur 画到离屏小画布，再整张模糊一次：
  // 既比逐 chunk 设 filter 快，也避免 chunk 接缝在圆角处产生锯齿/色带。
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxW = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
    const w = typeof lineWidth === "function" ? lineWidth(i) : lineWidth;
    if (w > maxW) maxW = w;
  }
  const pad = Math.ceil(blurPx * 3 + maxW / 2 + 2);
  const ox = Math.floor(minX - pad);
  const oy = Math.floor(minY - pad);
  const ow = Math.ceil(maxX - minX + pad * 2);
  const oh = Math.ceil(maxY - minY + pad * 2);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const sw = Math.max(1, Math.ceil(ow * dpr));
  const sh = Math.max(1, Math.ceil(oh * dpr));
  ensureSoftCanvas(sw, sh);
  if (!softCanvas || !softCtx) {
    const prevFilter = bandCtx.filter;
    bandCtx.filter = `blur(${blurPx}px)`;
    try {
      strokeChunkBand(bandCtx, pts, lineWidth, alphaAt, colorAt, toolFade);
    } finally {
      bandCtx.filter = prevFilter;
    }
    return;
  }
  softCtx.setTransform(1, 0, 0, 1, 0, 0);
  softCtx.clearRect(0, 0, softCanvas.width, softCanvas.height);
  // 离屏画布按 DPR 渲染，避免圆角/细线在低分辨率下产生锯齿。
  softCtx.setTransform(dpr, 0, 0, dpr, -ox * dpr, -oy * dpr);
  strokeChunkBand(softCtx, pts, lineWidth, alphaAt, colorAt, toolFade);
  const prevFilter = bandCtx.filter;
  bandCtx.filter = `blur(${blurPx}px)`;
  bandCtx.drawImage(softCanvas, 0, 0, sw, sh, ox, oy, ow, oh);
  bandCtx.filter = prevFilter;
}

function drawPanel(
  el: HTMLElement,
  ctx2: CanvasRenderingContext2D,
  cards: LightSet,
): void {
  const rect = el.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return;

  const cs = getComputedStyle(el);
  const parsedR = parseFloat(cs.borderRadius);
  const corner = Number.isFinite(parsedR) && parsedR > 0 ? parsedR : 16;
  const o = 1;
  const x0 = rect.left - o;
  const y0 = rect.top - o;
  const x1 = rect.right + o;
  const y1 = rect.bottom + o;
  const rc = corner + o;

  const R = MAX_SOURCE_R;
  const near = cards.colors.filter(
    (c) =>
      c.r.right >= x0 - R &&
      c.r.left <= x1 + R &&
      c.r.bottom >= y0 - R &&
      c.r.top <= y1 + R,
  );
  const nearLums = cards.lums.filter(
    (c) =>
      c.inner &&
      c.r.right >= x0 - R &&
      c.r.left <= x1 + R &&
      c.r.bottom >= y0 - R &&
      c.r.top <= y1 + R,
  );
  const innerColors = cards.colors.filter(
    (c) =>
      c.inner &&
      c.r.right >= x0 - R &&
      c.r.left <= x1 + R &&
      c.r.bottom >= y0 - R &&
      c.r.top <= y1 + R,
  );
  const nearCurve = cards.curve.filter(
    (c) =>
      c.r.right >= x0 - R &&
      c.r.left <= x1 + R &&
      c.r.bottom >= y0 - R &&
      c.r.top <= y1 + R,
  );
  const tool = isToolbar(el);
  const panels = tool ? panelRectsForTool() : null;
  // 工具栏自带淡入/淡出动画，Canvas 环带直接跟随其透明度，避免退场比工具栏慢
  const toolFade = tool
    ? Math.max(0, Math.min(1, parseFloat(cs.opacity) || 0))
    : 1;
  const panelBase = panelBaseLum(el);

  const pts = ringPoints(x0, y0, x1, y1, rc);
  if (pts.length < 2) return;
  const mainPts = insetRing(rect, corner, MENISCUS_INSET);
  const st = stateForRing(el, pts.length);
  const ist = stateForInner(el, mainPts.length);
  const rawGl = new Array<number>(mainPts.length).fill(0);
  const outsideFade = (sourceRect: DOMRect): number => {
    const gap = Math.max(
      rect.left - sourceRect.right,
      sourceRect.left - rect.right,
      rect.top - sourceRect.bottom,
      sourceRect.top - rect.bottom,
      0,
    );
    // 贴边/在内部为 1；越出边界采样半径连续收窄，外部光源衰减更快。
    // 分母用 10 让退出时尾巴更长、更柔，不会在刚出界时突然收没。
    return 10 / (10 + gap);
  };

  for (let i = 0; i < pts.length; i++) {
    const x = pts[i].x;
    const y = pts[i].y;
    const overPanel = panels?.some(
      (p) =>
        x >= p.left - 4 &&
        x <= p.right + 4 &&
        y >= p.top - 4 &&
        y <= p.bottom + 4,
    );
    const lowSample = overPanel ? sampleLowLayer(x, y) : null;
    const curveSample = sampleColor(x, y, nearCurve, SAMPLE_R);
    const sample = overPanel
      ? curveSample &&
        (!lowSample || curveSample.s >= lowSample.s * 0.75)
        ? curveSample
        : lowSample
      : sampleColor(x, y, near, SAMPLE_R);
    const targetA = sample ? sample.s : 0;
    const aDelta = targetA - st.a[i];
    st.a[i] += aDelta * FADE_K;
    if (Math.abs(aDelta) > 0.004) fadePending = true;
    const c = sample ? sample.c : null;
    if (c) {
      const fresh = st.a[i] < 0.01 && targetA > 0;
      const k = fresh ? 1 : COLOR_K;
      st.r[i] += (c.r - st.r[i]) * k;
      st.g[i] += (c.g - st.g[i]) * k;
      st.b[i] += (c.b - st.b[i]) * k;
    }
  }

  // 内光直接在内圈路径上逐点采样，不再从外圈做序号映射，
  // 圆角处的采样点与绘制点一一对应。
  for (let j = 0; j < mainPts.length; j++) {
    const glowP = mainPts[j];
    const lumSample = sampleLum(
      glowP.x,
      glowP.y,
      nearLums,
      INNER_SAMPLE_R,
      outsideFade,
    );
    const lum = lumSample?.lum ?? panelBase;
    const prox = lumSample?.prox ?? 0;
    const contrast = Math.abs(lum - panelBase) / 255;
    const innerTint = sampleColor(
      glowP.x,
      glowP.y,
      innerColors,
      INNER_SAMPLE_R,
      outsideFade,
    );
    const colorEnergy = innerTint
      ? Math.min(1, innerTint.s / 1.1)
      : 0;
    const lumEnergy =
      Math.min(1, contrast * 1.6) * Math.pow(prox, 0.8);
    const targetGl = Math.min(1, colorEnergy + lumEnergy * 0.55);
    rawGl[j] = targetGl;
    if (innerTint) {
      const kg = ist.gl[j] < 0.01 && targetGl > 0 ? 1 : COLOR_K;
      ist.ir[j] += (innerTint.c.r - ist.ir[j]) * kg;
      ist.ig[j] += (innerTint.c.g - ist.ig[j]) * kg;
      ist.ib[j] += (innerTint.c.b - ist.ib[j]) * kg;
    }
  }

  const rawN = rawGl.length;
  // 主路径在圆角处点距约 2px、直边约 8px，不能用固定点数窗口算局部峰值，
  // 否则圆角/直边的暗部形状会不一致。这里改成按路径弧长开窗。
  const cumLen = new Array<number>(rawN);
  cumLen[0] = 0;
  for (let i = 1; i < rawN; i++) {
    cumLen[i] =
      cumLen[i - 1] +
      Math.hypot(
        mainPts[i].x - mainPts[i - 1].x,
        mainPts[i].y - mainPts[i - 1].y,
      );
  }
  const totalLen = cumLen[rawN - 1];
  const pathDist = (a: number, b: number): number => {
    const d = Math.abs(cumLen[a] - cumLen[b]);
    return Math.min(d, Math.max(0, totalLen - d));
  };

  // 平滑与局部峰值都沿整圈路径弧长开窗（跨圆角/直边边界连续），
  // 避免光源靠近圆角时在段边界被切成孤立暗点。
  const shadeGl = new Array<number>(rawN);
  for (let i = 0; i < rawN; i++) {
    let sum = rawGl[i];
    let wsum = 1;
    for (const dir of [-1, 1]) {
      for (let step = 1; step < rawN; step++) {
        const j = (i + dir * step + rawN) % rawN;
        if (j === i) break;
        const d = pathDist(i, j);
        if (d > SHADE_SMOOTH_R) break;
        const w = 1 - d / SHADE_SMOOTH_R;
        sum += rawGl[j] * w;
        wsum += w;
      }
    }
    shadeGl[i] = sum / wsum;
  }

  const rawSh = new Array<number>(rawN).fill(0);
  for (let i = 0; i < rawGl.length; i++) {
    const glDelta = rawGl[i] - ist.gl[i];
    ist.gl[i] += glDelta * FADE_K;
    if (Math.abs(glDelta) > 0.004) fadePending = true;
    let targetSh = 0;
    let localPeak = shadeGl[i];
    let localPeakIdx = i;
    for (const dir of [-1, 1]) {
      for (let step = 1; step < rawN; step++) {
        const j = (i + dir * step + rawN) % rawN;
        if (j === i) break;
        if (pathDist(i, j) > SHADE_WINDOW_R) break;
        if (shadeGl[j] > localPeak) {
          localPeak = shadeGl[j];
          localPeakIdx = j;
        }
      }
    }
    // 暗部只出现在局部亮斑外一圈：距离局部峰值约 4px 处最强，
    // 12px 外归 0。亮度门(peak)与本地亮度门(rawGl)保证暗部随光消失。
    if (localPeak > 0.12) {
      const dPeak = pathDist(i, localPeakIdx);
      const edge = shadeBumpAt(dPeak);
      const bright = smoothstep(0.12, 0.45, localPeak);
      // 亮度门：内光亮度低于 0.22 后暗部开始减弱，到 0.55 完全关闭；
      // 既避免中后段衰减带残留，又不会在亮端切得太硬。
      const local = smoothstep(0.22, 0.55, rawGl[i]);
      targetSh = edge * bright * local * 1.0;
    }
    rawSh[i] = targetSh;
  }
  // 对暗部目标本身做一次沿路径的宽窗平滑：
  // 圆角点距约 2px，不平滑会把暗部收敛成孤立小点。
  for (let i = 0; i < rawN; i++) {
    let sum = rawSh[i];
    let wsum = 1;
    for (const dir of [-1, 1]) {
      for (let step = 1; step < rawN; step++) {
        const j = (i + dir * step + rawN) % rawN;
        if (j === i) break;
        const d = pathDist(i, j);
        if (d > SHADE_OUT_SMOOTH_R) break;
        const w = 1 - d / SHADE_OUT_SMOOTH_R;
        sum += rawSh[j] * w;
        wsum += w;
      }
    }
    const shDelta = sum / wsum - ist.sh[i];
    ist.sh[i] += shDelta * FADE_K;
    if (Math.abs(shDelta) > 0.004) fadePending = true;
  }
  // 暗部不是压暗，而是在该处停止绘制内光（lit=0），
  // 让底层默认高光样式的暗部自己透出来；shade 只是控制这个“留空”的平滑形状。
  const litAt = (i: number): number =>
    ist.gl[i] * Math.max(0, 1 - ist.sh[i]);
  const tintAt = (i: number): Rgb =>
    litAt(i) > 0.02
      ? { r: ist.ir[i], g: ist.ig[i], b: ist.ib[i] }
      : { r: 255, g: 255, b: 255 };

  // 外圈染色高光
  strokeHighQualityBand(
    ctx2,
    pts,
    LINE_W,
    (i) => st.a[i] * LINE_ALPHA,
    (i) => ({ r: st.r[i], g: st.g[i], b: st.b[i] }),
    toolFade,
  );
  // 细光核：在内光上做暗部衰减，贴住高光带内侧，不另画黑线；
  // 宽度随亮度微调，靠近光源时略宽，融合更自然。
  const coreW = (i: number): number =>
    Math.max(0.6, MENISCUS_WIDTH * (0.3 + 0.85 * litAt(i)));
  strokeGlowBand(
    ctx2,
    mainPts,
    coreW,
    MENISCUS_BLUR,
    (i) => litAt(i) * MENISCUS_ALPHA,
    (i) => tintAt(i),
    toolFade,
  );
  // 近光晕：能量越高越宽，亮度降低时半径同步收窄
  strokeGlowBand(
    ctx2,
    mainPts,
    (i) => Math.max(0.5, MENISCUS_HALO_WIDTH * Math.pow(litAt(i), 1.25)),
    MENISCUS_HALO_BLUR,
    (i) => Math.pow(litAt(i), 2) * MENISCUS_HALO_ALPHA,
    (i) => tintAt(i),
    toolFade,
  );
}

function collectCards(): LightSet {
  const colors: ColorSource[] = [];
  const lums: LumSource[] = [];
  const curve = curvePointSources();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const nodes = cardNodes ?? refreshCardNodes();
  nodes.forEach(({ el, accents }) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    if (r.right < -MAX_SOURCE_R || r.left > vw + MAX_SOURCE_R) return;
    if (r.bottom < -MAX_SOURCE_R || r.top > vh + MAX_SOURCE_R) return;
    const surfaceLum = surfaceLumOf(el);
    if (surfaceLum != null) {
      lums.push({ r, lum: surfaceLum, power: 0.7, inner: true });
    }
    const color = cardColor(el);
    if (!color) return;
    const selected = el.classList.contains("is-selected");
    if (el.classList.contains("enabled") || selected) {
      colors.push({
        r,
        color,
        border: true,
        power: selected ? 1.8 : 1,
      });
    }
    accents.forEach((sub) => {
      const sr = sub.getBoundingClientRect();
      if (sr.width < 2 || sr.height < 2) return;
      const power = sub.classList.contains("enable-dot")
        ? 2.4
        : sub.classList.contains("effect-dot")
          ? 1.4
          : 1.2;
      colors.push({ r: sr, color, power, inner: true });
      lums.push({ r: sr, lum: rgbLuminance(color), power, inner: true });
    });
  });
  return { colors, lums, curve };
}

function isToolbar(el: HTMLElement): boolean {
  return el.classList.contains("fx-toolbar");
}

function dirtyForEls(
  els: HTMLElement[],
): { x: number; y: number; w: number; h: number } | null {
  if (!els.length) return null;
  const PAD = 32;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    if (r.left - PAD < minX) minX = r.left - PAD;
    if (r.top - PAD < minY) minY = r.top - PAD;
    if (r.right + PAD > maxX) maxX = r.right + PAD;
    if (r.bottom + PAD > maxY) maxY = r.bottom + PAD;
  }
  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function renderToPanelBuffer(
  el: HTMLElement,
  cards: LightSet,
): PanelBuffer | null {
  const rect = el.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return null;
  const PAD = 28;
  const x = rect.left - PAD;
  const y = rect.top - PAD;
  const w = rect.width + PAD * 2;
  const h = rect.height + PAD * 2;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  let buf = panelBuffers.get(el);
  if (
    !buf ||
    buf.w !== w ||
    buf.h !== h ||
    buf.dpr !== dpr ||
    buf.c.width !== Math.ceil(w * dpr) ||
    buf.c.height !== Math.ceil(h * dpr)
  ) {
    const c = document.createElement("canvas");
    const k = c.getContext("2d");
    if (!k) return null;
    buf = { c, k, x, y, w, h, dpr };
    panelBuffers.set(el, buf);
  }
  buf.x = x;
  buf.y = y;
  if (
    buf.c.width !== Math.ceil(w * dpr) ||
    buf.c.height !== Math.ceil(h * dpr)
  ) {
    buf.c.width = Math.ceil(w * dpr);
    buf.c.height = Math.ceil(h * dpr);
  }
  buf.k.setTransform(1, 0, 0, 1, 0, 0);
  buf.k.clearRect(0, 0, buf.c.width, buf.c.height);
  buf.k.setTransform(dpr, 0, 0, dpr, -x * dpr, -y * dpr);
  drawPanel(el, buf.k, cards);
  return buf;
}

function clearDirtyUnion(
  k: CanvasRenderingContext2D,
  a: { x: number; y: number; w: number; h: number } | null,
  b: { x: number; y: number; w: number; h: number } | null,
): void {
  if (!a && !b) return;
  if (!a) {
    k.clearRect(b!.x, b!.y, b!.w, b!.h);
    return;
  }
  if (!b) {
    k.clearRect(a.x, a.y, a.w, a.h);
    return;
  }
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const x2 = Math.max(a.x + a.w, b.x + b.w);
  const y2 = Math.max(a.y + a.h, b.y + b.h);
  k.clearRect(x, y, x2 - x, y2 - y);
}

function paintLayerPair(
  c: HTMLCanvasElement | null,
  k: CanvasRenderingContext2D | null,
  els: HTMLElement[],
  cards: LightSet,
  kind: "base" | "tool",
): void {
  if (!c || !k) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = window.innerWidth;
  const h = window.innerHeight;
  const sized = c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr);
  c.style.width = `${w}px`;
  c.style.height = `${h}px`;
  if (sized) {
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
  }
  k.setTransform(dpr, 0, 0, dpr, 0, 0);
  const prev = kind === "base" ? prevBaseDirty : prevToolDirty;
  const next = dirtyForEls(els);
  if (sized) {
    k.clearRect(0, 0, w, h);
  } else {
    clearDirtyUnion(k, prev, next);
  }
  if (kind === "base") prevBaseDirty = next;
  else prevToolDirty = next;
  if (!els.length) return;
  els.forEach((el) => {
    const buf = renderToPanelBuffer(el, cards);
    if (buf) {
      k.drawImage(
        buf.c,
        buf.x,
        buf.y,
        buf.w,
        buf.h,
      );
    }
  });
}

function paint(): void {
  raf = 0;
  try {
    if (!running || !targets.size) return;
    fadePending = false;
    const cards = collectCards();
    const els = [...targets];
    if (paintMode !== "tool") {
      paintLayerPair(
        canvas,
        ctx,
        els.filter((el) => !isToolbar(el)),
        cards,
        "base",
      );
      if (els.some(isToolbar)) syncLowCache();
    }
    paintLayerPair(
      toolCanvas,
      toolCtx,
      els.filter(isToolbar),
      cards,
      "tool",
    );
    if (paintMode === "full" && fadePending) {
      // 状态平滑一次只收敛一部分；光源移出后继续补帧直到褪色完成。
      window.setTimeout(() => schedule("full"), 33);
    }
  } catch (err) {
    console.error("[edgeTint] paint failed", err);
  }
}

function schedule(mode: "tool" | "full" = "full"): void {
  if (!running) return;
  paintMode = mode;
  if (raf) return;
  raf = requestAnimationFrame(paint);
}

function onScroll(): void {
  // 滚动中只重绘移动的工具栏；底卡是固定在视口的，
  // 等滚动停顿后再整层刷新，避免滚得快时帧内成本过高。
  window.clearTimeout(scrollIdleTimer);
  scrollIdleTimer = window.setTimeout(() => schedule("full"), 140);
  schedule("tool");
}

function onResize(): void {
  schedule("full");
}

function onFocus(): void {
  schedule("full");
}

function onVisibilityChange(): void {
  schedule("full");
}

function start(): void {
  if (running) return;
  ensureCanvas();
  running = true;
  window.addEventListener("scroll", onScroll, {
    capture: true,
    passive: true,
  });
  window.addEventListener("resize", onResize);
  window.addEventListener("focus", onFocus);
  document.addEventListener("visibilitychange", onVisibilityChange);
  themeObserver = new MutationObserver(() => {
    colorCache = new WeakMap();
    schedule();
  });
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  layoutObserver = new MutationObserver((records) => {
    const toolbarMoved = records.some(
      (m) =>
        m.type === "attributes" &&
        m.attributeName === "style" &&
        m.target instanceof HTMLElement &&
        m.target.classList.contains("fx-toolbar"),
    );
    const selectionChanged = records.some(
      (m) =>
        m.type === "attributes" &&
        m.attributeName === "class" &&
        m.target instanceof HTMLElement &&
        m.target.hasAttribute("data-dnd-id"),
    );
    const structureChanged =
      records.some(
        (m) =>
          m.type === "childList" ||
          (m.type === "attributes" &&
            (m.attributeName === "data-dnd-id" ||
              m.attributeName === "data-dnd-group")),
      );
    if (structureChanged) {
      refreshCardNodes();
    }
    if (toolbarMoved) {
      // 工具栏位移动画每帧改 style；MutationObserver 在该帧渲染前触发，
      // 同步重画可以对齐当前帧位置，避免 Canvas 永远慢半拍。
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      paintMode = "tool";
      paint();
      return;
    }
    if (selectionChanged) {
      // 框选拖动会每帧改 is-selected；不立即全量重绘，
      // 停顿后刷新一次，让选中描边权重收敛。
      window.clearTimeout(selectionTimer);
      selectionTimer = window.setTimeout(() => schedule("full"), 160);
      return;
    }
    schedule("full");
  });
  layoutObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "style", "data-dnd-id", "data-dnd-group"],
  });
  schedule();
}

function stop(): void {
  running = false;
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  window.removeEventListener("scroll", onScroll, {
    capture: true,
  } as EventListenerOptions);
  window.removeEventListener("resize", onResize);
  window.removeEventListener("focus", onFocus);
  document.removeEventListener("visibilitychange", onVisibilityChange);
  window.clearTimeout(scrollIdleTimer);
  scrollIdleTimer = 0;
  window.clearTimeout(selectionTimer);
  selectionTimer = 0;
  themeObserver?.disconnect();
  themeObserver = null;
  layoutObserver?.disconnect();
  layoutObserver = null;
  colorCache = new WeakMap();
  canvas?.remove();
  canvas = null;
  ctx = null;
  toolCanvas?.remove();
  toolCanvas = null;
  toolCtx = null;
  softCanvas?.remove();
  softCanvas = null;
  softCtx = null;
  ssCanvas?.remove();
  ssCanvas = null;
  ssCtx = null;
}

function registerTarget(el: HTMLElement): void {
  if (targets.has(el)) return;
  const nextHost =
    (el.closest(".device-body") as HTMLElement | null) ?? document.body;
  if (!targets.size) {
    host = nextHost;
    start();
  } else if (host !== nextHost) {
    // 语言/设备切换会用新的 key 重建 .device-body：旧宿主已脱离文档时，
    // 必须把 Canvas 挪到新宿主，否则画面会画在不可见节点上。
    ensureCanvas(nextHost);
  }
  targets.add(el);
  const ro = new ResizeObserver(() => schedule("full"));
  ro.observe(el);
  targetRos.set(el, ro);
}

function removeTarget(el: HTMLElement): void {
  targetRos.get(el)?.disconnect();
  targetRos.delete(el);
  targets.delete(el);
  const buf = panelBuffers.get(el);
  if (buf) {
    buf.c.remove();
    panelBuffers.delete(el);
  }
  if (!targets.size) stop();
}

function syncTargets(): void {
  const nodes = document.querySelectorAll<HTMLElement>(
    ".fx-curve, .fx-dev, .fx-toolbar",
  );
  const found = new Set<HTMLElement>();
  nodes.forEach((el) => {
    found.add(el);
    registerTarget(el);
  });
  [...targets].forEach((el) => {
    if (!found.has(el) || !el.isConnected) removeTarget(el);
  });
}

/** 模块级自动扫描：不依赖 React hook 生命周期，HMR 或晚挂载都能自愈。 */
function startAuto(): void {
  if (autoStarted) return;
  autoStarted = true;
  autoMo = new MutationObserver(syncTargets);
  autoMo.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  if (document.body) {
    syncTargets();
  } else {
    document.addEventListener("DOMContentLoaded", syncTargets, { once: true });
  }
  // 兜底扫描：不依赖 MutationObserver 时序，面板出现后最多 300ms 内注册
  autoScanTimer = window.setInterval(syncTargets, 300);
}

function stopAuto(): void {
  autoStarted = false;
  window.clearInterval(autoScanTimer);
  autoScanTimer = 0;
  autoMo?.disconnect();
  autoMo = null;
  [...targets].forEach(removeTarget);
}

/** 保留组件侧调用点（注册交给模块级扫描统一管理）。 */
export function useEdgeTintLayer(_ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    startAuto();
  }, []);
}

try {
  startAuto();
} catch (err) {
  console.error("[edgeTint] init failed", err);
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    stopAuto();
  });
}
