import { useEffect, type RefObject } from "react";

/**
 * 外部 Canvas 环带染色层（分两层）：
 * - 设备卡/曲线卡画在低层（z25），悬浮工具栏盖在上面时会被它的玻璃背板模糊；
 * - 悬浮工具栏自己的环带画在高层（z35），始终显示在工具栏之上。
 * 颜色只来自卡片真正带主题色的部分（描边/chip/圆点），黑白区域不掺色相。
 */

type Rgb = { r: number; g: number; b: number };
type ColorSource = {
  r: DOMRect;
  color: Rgb;
  /** 整张卡片只算描边一圈；内部空白不算色源 */
  border?: boolean;
  /** 光源强度倍率：框选后描边加粗，作为光源更亮/权重更大 */
  power?: number;
};

let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let toolCanvas: HTMLCanvasElement | null = null;
let toolCtx: CanvasRenderingContext2D | null = null;
let raf = 0;
let running = false;
let themeObserver: MutationObserver | null = null;
let layoutObserver: MutationObserver | null = null;
let interval = 0;
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

const SAMPLE_R = 32;
const MAX_POWER = 2.4;
const MAX_SOURCE_R = Math.ceil(SAMPLE_R * Math.sqrt(MAX_POWER));
const RING_STEP = 8;
const ARC_STEP = 2;
const CHUNK_SEG = 8;
const LINE_W = 2;
const LINE_ALPHA = 0.3;
const FADE_K = 0.3;
const COLOR_K = 0.4;
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
  if (canvas && ctx && toolCanvas && toolCtx) return;
  if (h) host = h;
  if (!host) host = document.body;
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
): EdgeSample {
  let wSum = 0;
  let r = 0;
  let g = 0;
  let b = 0;
  for (const c of sources) {
    const d = c.border ? distToBorder(x, y, c.r) : distToRect(x, y, c.r);
    // 光源半径随强度缩放：徽标 2.4 -> 约 1.55 倍基础半径，框选次之，默认最短
    const p = c.power ?? 1;
    const sr = radius * Math.sqrt(p);
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

function rgba(c: Rgb, a: number): string {
  return `rgba(${c.r | 0},${c.g | 0},${c.b | 0},${Math.max(0, Math.min(1, a))})`;
}

/** 沿圆角矩形路径生成连续采样点（直边与圆角之间不设边界）。 */
function ringPoints(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  rc: number,
): Array<{ x: number; y: number }> {
  const pts: Array<{ x: number; y: number }> = [];
  const addLine = (ax: number, ay: number, bx: number, by: number) => {
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 0.5) return;
    const n = Math.max(1, Math.ceil(len / RING_STEP));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      pts.push({ x: ax + (bx - ax) * t, y: ay + (by - ay) * t });
    }
  };
  const addArc = (cx: number, cy: number, a0: number, a1: number) => {
    const span = Math.abs(a1 - a0);
    const len = span * rc;
    if (len < 0.5) return;
    const n = Math.max(1, Math.ceil(len / ARC_STEP));
    for (let i = 0; i <= n; i++) {
      const a = a0 + (a1 - a0) * (i / n);
      pts.push({ x: cx + Math.cos(a) * rc, y: cy + Math.sin(a) * rc });
    }
  };

  addArc(x0 + rc, y0 + rc, Math.PI, Math.PI * 1.5);
  addLine(x0 + rc, y0, x1 - rc, y0);
  addArc(x1 - rc, y0 + rc, Math.PI * 1.5, Math.PI * 2);
  addLine(x1, y0 + rc, x1, y1 - rc);
  addArc(x1 - rc, y1 - rc, 0, Math.PI * 0.5);
  addLine(x1 - rc, y1, x0 + rc, y1);
  addArc(x0 + rc, y1 - rc, Math.PI * 0.5, Math.PI);
  addLine(x0, y1 - rc, x0, y0 + rc);
  return pts;
}

/** 每个采样点的平滑状态：alpha 独立逼近目标，颜色做插值。 */
const ringStates = new WeakMap<
  HTMLElement,
  { a: number[]; r: number[]; g: number[]; b: number[] }
>();

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

function panelRectsForTool(): DOMRect[] {
  return [...document.querySelectorAll<HTMLElement>(".fx-curve, .fx-dev")]
    .map((el) => el.getBoundingClientRect())
    .filter((r) => r.width > 2 && r.height > 2);
}

/** 从低层 Canvas 读设备/曲线卡环带颜色（屏幕坐标）。 */
function sampleLowLayer(x: number, y: number): EdgeSample {
  if (!canvas || !ctx) return null;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const px = Math.max(2, Math.min(canvas.width - 3, Math.round(x * dpr)));
  const py = Math.max(2, Math.min(canvas.height - 3, Math.round(y * dpr)));
  let ta = 0;
  let tr = 0;
  let tg = 0;
  let tb = 0;
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
  const avg = ta / (255 * 25);
  if (avg < 0.02) return null;
  return {
    c: { r: tr / ta, g: tg / ta, b: tb / ta },
    // 归一化到和 DOM 采样相同的强度空间，保留徽标 > 框选 > 描边的亮度差
    s: Math.min(2.4, avg / LINE_ALPHA),
  };
}

function drawPanel(
  el: HTMLElement,
  ctx2: CanvasRenderingContext2D,
  cards: ColorSource[],
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
  const near = cards.filter(
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

  const pts = ringPoints(x0, y0, x1, y1, rc);
  if (pts.length < 2) return;
  const st = stateForRing(el, pts.length);

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
    const sample = overPanel
      ? sampleLowLayer(x, y)
      : sampleColor(x, y, near, SAMPLE_R);
    const targetA = sample ? sample.s : 0;
    st.a[i] += (targetA - st.a[i]) * FADE_K;
    const c = sample ? sample.c : null;
    if (c) {
      const fresh = st.a[i] < 0.01 && targetA > 0;
      const k = fresh ? 1 : COLOR_K;
      st.r[i] += (c.r - st.r[i]) * k;
      st.g[i] += (c.g - st.g[i]) * k;
      st.b[i] += (c.b - st.b[i]) * k;
    }
  }

  ctx2.globalAlpha = 1;
  const segs = pts.length - 1;
  for (let start = 0; start < segs; start += CHUNK_SEG) {
    const end = Math.min(start + CHUNK_SEG, segs);
    let has = false;
    for (let i = start; i <= end; i++) {
      if (st.a[i] > 0.003) {
        has = true;
        break;
      }
    }
    if (!has) continue;

    const grad = ctx2.createLinearGradient(
      pts[start].x,
      pts[start].y,
      pts[end].x,
      pts[end].y,
    );
    for (let i = start; i <= end; i++) {
      const t = (i - start) / (end - start);
      const alpha = st.a[i] * LINE_ALPHA * toolFade;
      grad.addColorStop(
        Math.min(1, Math.max(0, t)),
        rgba({ r: st.r[i], g: st.g[i], b: st.b[i] }, alpha),
      );
    }
    ctx2.strokeStyle = grad;
    ctx2.lineWidth = LINE_W;
    ctx2.lineCap = "butt";
    ctx2.beginPath();
    ctx2.moveTo(pts[start].x, pts[start].y);
    for (let i = start + 1; i <= end; i++) {
      ctx2.lineTo(pts[i].x, pts[i].y);
    }
    ctx2.stroke();
  }
}

function collectCards(): ColorSource[] {
  const list: ColorSource[] = [];
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const nodes = cardNodes ?? refreshCardNodes();
  nodes.forEach(({ el, accents }) => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    if (r.right < -MAX_SOURCE_R || r.left > vw + MAX_SOURCE_R) return;
    if (r.bottom < -MAX_SOURCE_R || r.top > vh + MAX_SOURCE_R) return;
    const color = cardColor(el);
    if (!color) return;
    const selected = el.classList.contains("is-selected");
    if (el.classList.contains("enabled") || selected) {
      list.push({
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
      list.push({ r: sr, color, power });
    });
  });
  return list;
}

function isToolbar(el: HTMLElement): boolean {
  return el.classList.contains("fx-toolbar");
}

function paintLayer(
  c: HTMLCanvasElement | null,
  k: CanvasRenderingContext2D | null,
  els: HTMLElement[],
  cards: ColorSource[],
): void {
  if (!c || !k) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = window.innerWidth;
  const h = window.innerHeight;
  c.style.width = `${w}px`;
  c.style.height = `${h}px`;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
  }
  k.setTransform(dpr, 0, 0, dpr, 0, 0);
  k.clearRect(0, 0, w, h);
  if (!els.length) return;
  els.forEach((el) => drawPanel(el, k, cards));
}

function paint(): void {
  raf = 0;
  if (!running || !targets.size) return;
  const cards = collectCards();
  const els = [...targets];
  paintLayer(canvas, ctx, els.filter((el) => !isToolbar(el)), cards);
  paintLayer(toolCanvas, toolCtx, els.filter(isToolbar), cards);
}

function schedule(): void {
  if (!running) return;
  if (raf) return;
  raf = requestAnimationFrame(paint);
}

function start(): void {
  if (running) return;
  ensureCanvas();
  running = true;
  window.addEventListener("scroll", schedule, {
    capture: true,
    passive: true,
  });
  window.addEventListener("resize", schedule);
  themeObserver = new MutationObserver(() => {
    colorCache = new WeakMap();
    schedule();
  });
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  layoutObserver = new MutationObserver((records) => {
    if (
      records.some(
        (m) =>
          m.type === "childList" ||
          (m.type === "attributes" && m.attributeName !== "style"),
      )
    ) {
      refreshCardNodes();
    }
    schedule();
  });
  layoutObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "style", "data-dnd-id", "data-dnd-group"],
  });
  interval = window.setInterval(schedule, 250);
  schedule();
}

function stop(): void {
  running = false;
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  window.removeEventListener("scroll", schedule, {
    capture: true,
  } as EventListenerOptions);
  window.removeEventListener("resize", schedule);
  themeObserver?.disconnect();
  themeObserver = null;
  layoutObserver?.disconnect();
  layoutObserver = null;
  window.clearInterval(interval);
  interval = 0;
  colorCache = new WeakMap();
  canvas?.remove();
  canvas = null;
  ctx = null;
  toolCanvas?.remove();
  toolCanvas = null;
  toolCtx = null;
}

function registerTarget(el: HTMLElement): void {
  if (targets.has(el)) return;
  if (!targets.size) {
    host =
      (el.closest(".device-body") as HTMLElement | null) ?? document.body;
    start();
  }
  targets.add(el);
  const ro = new ResizeObserver(schedule);
  ro.observe(el);
  targetRos.set(el, ro);
}

function removeTarget(el: HTMLElement): void {
  targetRos.get(el)?.disconnect();
  targetRos.delete(el);
  targets.delete(el);
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
}

function stopAuto(): void {
  autoStarted = false;
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

startAuto();

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    stopAuto();
  });
}
