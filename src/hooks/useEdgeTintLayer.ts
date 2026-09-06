import { useEffect, type RefObject } from "react";

/**
 * 外部 Canvas 环带染色层：不嵌进面板 DOM，避免干扰面板合成。
 * 对每个注册的面板，沿四条环带边取采样点，从真实卡片 DOM 读几何+主题色，
 * 按“近处优先 + 覆盖面积加权”混色（不是 CSS 模糊平均），画成边缘色带。
 */

type Rgb = { r: number; g: number; b: number };

let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let raf = 0;
let running = false;
const targets = new Set<HTMLElement>();
const colorCache = new WeakMap<HTMLElement, { at: number; color: Rgb | null }>();

function ensureCanvas(): void {
  if (canvas) return;
  canvas = document.createElement("canvas");
  canvas.style.cssText =
    "position:fixed;left:0;top:0;pointer-events:none;z-index:25;";
  ctx = canvas.getContext("2d");
  if (!ctx) {
    canvas = null;
    return;
  }
  document.body.appendChild(canvas);
}

function parseColor(s: string): Rgb | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(s.trim());
  if (m) {
    const n = parseInt(m[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  const rgb = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(s.trim());
  if (rgb) {
    return { r: +rgb[1], g: +rgb[2], b: +rgb[3] };
  }
  return null;
}

function cardColor(el: HTMLElement): Rgb | null {
  const hit = colorCache.get(el);
  if (hit && performance.now() - hit.at < 400) return hit.color;
  const cs = getComputedStyle(el);
  const accent = cs.getPropertyValue("--card-accent").trim();
  const color = parseColor(accent) || parseColor(cs.getPropertyValue("--brand").trim());
  colorCache.set(el, { at: performance.now(), color });
  return color;
}

function distToRect(x: number, y: number, r: DOMRect): number {
  const dx = Math.max(r.left - x, 0, x - r.right);
  const dy = Math.max(r.top - y, 0, y - r.bottom);
  return Math.hypot(dx, dy);
}

function sampleColor(
  x: number,
  y: number,
  cards: Array<{ r: DOMRect; color: Rgb }>,
  radius: number,
): Rgb | null {
  let wSum = 0;
  let r = 0;
  let g = 0;
  let b = 0;
  for (const c of cards) {
    const d = distToRect(x, y, c.r);
    if (d > radius) continue;
    // 近处优先，且矩形越大（面积）贡献越大
    const area = Math.max(1, c.r.width * c.r.height);
    const w = Math.pow(1 - d / radius, 2) * Math.min(1, area / 30000);
    if (w <= 0) continue;
    wSum += w;
    r += c.color.r * w;
    g += c.color.g * w;
    b += c.color.b * w;
  }
  if (wSum <= 0) return null;
  return { r: r / wSum, g: g / wSum, b: b / wSum };
}

function drawPanel(el: HTMLElement, ctx2: CanvasRenderingContext2D): void {
  const rect = el.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return;

  const cards: Array<{ r: DOMRect; color: Rgb }> = [];
  document.querySelectorAll<HTMLElement>('[data-dnd-id]').forEach((card) => {
    if (card.dataset.dndGroup === "effects") return;
    const cr = card.getBoundingClientRect();
    if (cr.right < rect.left - 90 || cr.left > rect.right + 90) return;
    if (cr.bottom < rect.top - 90 || cr.top > rect.bottom + 90) return;
    const color = cardColor(card);
    if (color) cards.push({ r: cr, color });
  });
  if (!cards.length) return;

  const R = 90;
  // 四条边的采样点：向外 1px（覆盖环带），画半透明色带
  const step = 8;
  const edges: Array<{ a: [number, number]; b: [number, number] }> = [
    { a: [rect.left - 1, rect.top - 1], b: [rect.right + 1, rect.top - 1] },
    { a: [rect.left - 1, rect.bottom + 1], b: [rect.right + 1, rect.bottom + 1] },
    { a: [rect.left - 1, rect.top], b: [rect.left - 1, rect.bottom] },
    { a: [rect.right + 1, rect.top], b: [rect.right + 1, rect.bottom] },
  ];
  for (const e of edges) {
    const len = Math.hypot(e.b[0] - e.a[0], e.b[1] - e.a[1]);
    if (len < step) continue;
    const n = Math.max(2, Math.floor(len / step));
    const stops: Array<{ t: number; c: Rgb }> = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = e.a[0] + (e.b[0] - e.a[0]) * t;
      const y = e.a[1] + (e.b[1] - e.a[1]) * t;
      const c = sampleColor(x, y, cards, R);
      if (c) stops.push({ t, c });
    }
    if (stops.length < 2) continue;

    ctx2.globalAlpha = 0.55;
    ctx2.strokeStyle = "transparent";
    const grad = ctx2.createLinearGradient(e.a[0], e.a[1], e.b[0], e.b[1]);
    grad.addColorStop(0, `rgba(${stops[0].c.r | 0},${stops[0].c.g | 0},${stops[0].c.b | 0},0.95)`);
    for (const s of stops) {
      grad.addColorStop(s.t, `rgba(${s.c.r | 0},${s.c.g | 0},${s.c.b | 0},0.95)`);
    }
    ctx2.beginPath();
    ctx2.moveTo(e.a[0], e.a[1]);
    ctx2.lineTo(e.b[0], e.b[1]);
    ctx2.strokeStyle = grad;
    ctx2.lineWidth = 3;
    ctx2.stroke();
  }
  ctx2.globalAlpha = 1;
}

function paint(): void {
  raf = 0;
  if (!canvas || !ctx) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = window.innerWidth;
  const h = window.innerHeight;
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  targets.forEach((el) => drawPanel(el, ctx!));
}

function schedule(): void {
  if (!running) return;
  if (raf) return;
  raf = requestAnimationFrame(paint);
}

function start(): void {
  ensureCanvas();
  running = true;
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule);
  schedule();
}

function stop(): void {
  running = false;
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  window.removeEventListener("scroll", schedule);
  window.removeEventListener("resize", schedule);
  canvas?.remove();
  canvas = null;
  ctx = null;
}

/** 注册面板；面板几何变化（尺寸）也会触发重绘。 */
export function useEdgeTintLayer(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!targets.size) start();
    targets.add(el);
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    schedule();
    return () => {
      ro.disconnect();
      targets.delete(el);
      if (!targets.size) stop();
    };
  }, [ref]);
}
