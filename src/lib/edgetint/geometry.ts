// 边缘染色用到的纯函数：颜色解析/明暗判定/亮度/距离/缓动。
// 决策 5 阶段 A：从 hooks/useEdgeTintLayer.ts 原样搬出（行为零变化），
// 不持有任何模块状态，主模块反向 import。
export type Rgb = { r: number; g: number; b: number };

export type ColorSource = {
  r: DOMRect;
  color: Rgb;
  /** 卡片内容里的内部光源（chip/圆点），不是外圈描边 */
  inner?: boolean;
  /** 整张卡片只算描边一圈；内部空白不算色源 */
  border?: boolean;
  /** 光源强度倍率：框选后描边加粗，作为光源更亮/权重更大 */
  power?: number;
};

export type LumSource = {
  r: DOMRect;
  lum: number;
  /** 只在玻璃内部、会被面板模糊的内容；外圈高光/徽标不是内光光源 */
  inner?: boolean;
  /** 边框光源：点到整卡边框内侧距离；普通表面按点到矩形距离 */
  border?: boolean;
  power?: number;
};

export function parseColor(s: string): Rgb | null {
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

export function isDark(): boolean {
  return document.documentElement.dataset.theme === "dark";
}

export function edgeShadeRgb(): Rgb {
  const root = getComputedStyle(document.documentElement);
  const c = parseColor(root.getPropertyValue("--edge-shade").trim());
  if (c) return c;
  return isDark() ? { r: 8, g: 10, b: 13 } : { r: 74, g: 84, b: 102 };
}

/** 暗部叠加强度：浅色卡片底色亮，过强会变成灰色填充带。 */
export function edgeShadeAlpha(): number {
  return isDark() ? 0.22 : 0.10;
}

export function ringBaseRgb(): Rgb {
  const root = getComputedStyle(document.documentElement);
  const c = parseColor(root.getPropertyValue("--ring-base").trim());
  if (c) return c;
  return isDark() ? { r: 255, g: 255, b: 255 } : { r: 120, g: 128, b: 140 };
}

export function rgbLuminance(c: Rgb): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

/** 把「每帧插值系数」换算成「跨过 n 个基准帧」的等效系数。 */
export function scaleK(k: number, frames: number): number {
  return frames <= 1 ? k : 1 - Math.pow(1 - k, frames);
}

/** 取元素实际表面亮度；透明背景回退主题卡片色 */
export function surfaceLumOf(el: HTMLElement): number | null {
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

export function panelBaseLum(el: HTMLElement): number {
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

export function distToRect(x: number, y: number, r: DOMRect): number {
  const dx = Math.max(r.left - x, 0, x - r.right);
  const dy = Math.max(r.top - y, 0, y - r.bottom);
  return Math.hypot(dx, dy);
}

/** 卡片描边：点在卡内时只算到最近描边的距离，卡中心空白不等于 0。 */
export function distToBorder(x: number, y: number, r: DOMRect): number {
  const inside =
    x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  if (!inside) return distToRect(x, y, r);
  return Math.min(x - r.left, r.right - x, y - r.top, r.bottom - y);
}

export function rgba(c: Rgb, a: number): string {
  return `rgba(${c.r | 0},${c.g | 0},${c.b | 0},${Math.max(0, Math.min(1, a))})`;
}

export function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export type Grid<T> = {
  cell: number;
  buckets: Map<number, number[]>;
  list: T[];
  marks: Uint8Array;
  gen: number;
};

export function buildGrid<T extends { r: DOMRect }>(
  list: T[],
  cell = 64,
): Grid<T> {
  const buckets = new Map<number, number[]>();
  for (let i = 0; i < list.length; i++) {
    const r = list[i].r;
    const minX = Math.floor(r.left / cell);
    const maxX = Math.floor(r.right / cell);
    const minY = Math.floor(r.top / cell);
    const maxY = Math.floor(r.bottom / cell);
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const key = y * 100000 + x;
        const arr = buckets.get(key);
        if (arr) arr.push(i);
        else buckets.set(key, [i]);
      }
    }
  }
  return {
    cell,
    buckets,
    list,
    marks: new Uint8Array(list.length),
    gen: 0,
  };
}

export const SAMPLE_R = 32;

export const INNER_SAMPLE_R = 16;

export const MAX_POWER = 2.4;

export const MAX_SOURCE_R = Math.ceil(SAMPLE_R * Math.sqrt(MAX_POWER));

export const RING_STEP = 8;

export const ARC_STEP = 1;

export const LINE_ALPHA = 0.3;

export const FADE_K = 0.3;

export const COLOR_K = 0.4;

export const SHADE_SMOOTH_R = 4;

export const SHADE_OUT_SMOOTH_R = 14;

export const MENISCUS_INSET = 2;

export const MENISCUS_WIDTH = 3;

export const MENISCUS_ALPHA = 0.22;

export const MENISCUS_BLUR = 1.2;

export const MENISCUS_HALO_WIDTH = 8;

export const MENISCUS_HALO_ALPHA = 0.18;

export const MENISCUS_HALO_BLUR = 4;

/** 面板离屏缓冲复用窗口：位置由本次 blit 偏移保证精确，只有环带配色最多滞后这么久。 */
export const PANEL_REUSE_MS = 100;

/** 连续复用上限：保证至少每 3 帧完整重算一次，配色不会长时间停在上一次采样。 */
export const PANEL_REUSE_MAX = 2;

/** 褪色补帧链的基准步长：插值按「距上次真实渲染过了多少个基准步」推进，保证复用不改褪色时长。 */
export const FADE_FRAME_MS = 33;

export const Z_BASE = 25;

export const Z_TOOL = 35;

export const Z_SHADE = 26;

export const Z_TOOL_SHADE = 36;

export type EdgeSample = { c: Rgb; s: number } | null;

/** 距离主导的加权混色 + 强度：越近 alpha 越高，远处自然淡出。 */
export function sampleColor(
  x: number,
  y: number,
  sources: ColorSource[],
  radius: number,
  radiusFor?: (r: DOMRect) => number,
): EdgeSample {
  let wSum = 0;
  let wMax = 0;
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
    if (w > wMax) wMax = w;
    r += c.color.r * w;
    g += c.color.g * w;
    b += c.color.b * w;
  }
  if (wSum <= 0) return null;
  // 同一采样点多个光源只取最强一个的强度，避免选中数量增加导致亮度叠加。
  return { c: { r: r / wSum, g: g / wSum, b: b / wSum }, s: Math.min(2.4, wMax) };
}

export type RingPoint = { x: number; y: number; brk?: boolean };

/** 沿圆角矩形路径生成连续采样点，并用 brk 标记每条直边/圆角起点。 */
export function ringPoints(
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

export function panelRectsForTool(): DOMRect[] {
  return [...document.querySelectorAll<HTMLElement>(".fx-curve, .fx-dev")]
    .map((el) => el.getBoundingClientRect())
    .filter((r) => r.width > 2 && r.height > 2);
}

export function insetRing(
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

/** 按 ringPoints 的 brk 标记切出每段 [start, end]（含端点）。 */
export function segmentRanges(pts: Array<RingPoint>): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  let start = 0;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].brk) {
      if (i - 1 >= start) ranges.push([start, i - 1]);
      start = i;
    }
  }
  if (start < pts.length) ranges.push([start, pts.length - 1]);
  return ranges;
}

/// 把目标环的点映射到参考环：同段（直边/圆角）内按局部比例对齐，
/// 避免点数不同导致暗部沿路径逐渐斜跑。
export function mapRingToReference(
  target: Array<RingPoint>,
  reference: Array<RingPoint>,
): number[] {
  const tRanges = segmentRanges(target);
  const rRanges = segmentRanges(reference);
  const map = new Array<number>(target.length).fill(0);
  if (tRanges.length !== rRanges.length || !rRanges.length) {
    for (let i = 0; i < target.length; i++) {
      map[i] = Math.round(
        (i / Math.max(1, target.length - 1)) * (reference.length - 1),
      );
    }
    return map;
  }
  for (let s = 0; s < tRanges.length; s++) {
    const [ts, te] = tRanges[s];
    const [rs, re] = rRanges[s];
    const tn = Math.max(1, te - ts);
    const rn = Math.max(0, re - rs);
    for (let i = ts; i <= te && i < map.length; i++) {
      const t = (i - ts) / tn;
      map[i] = rs + Math.round(t * rn);
    }
  }
  return map;
}

export function strokeChunkBand(
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

export function strokeUniformBand(
  bandCtx: CanvasRenderingContext2D,
  pts: Array<RingPoint>,
  lineWidth: number,
  alpha: number,
  color: Rgb,
  toolFade: number,
): void {
  if (pts.length < 2 || alpha <= 0) return;
  const segs = pts.length - 1;
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
    bandCtx.strokeStyle = rgba(color, alpha * toolFade);
    bandCtx.lineWidth = lineWidth;
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
