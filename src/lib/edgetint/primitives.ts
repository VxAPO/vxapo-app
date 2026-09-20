// 边缘染色的零状态原语：网格查询、颜色/亮度采样、圆角路径、可见矩形与脏区计算。
// 决策 5 阶段 A（第三批）：从 hooks/useEdgeTintLayer.ts 原样搬出（行为零变化）；
// 本文件不持有任何模块状态，主模块反向 import。

import { MAX_POWER, distToBorder, distToRect, rgbLuminance } from "./geometry";
import type { ColorSource, EdgeSample, Grid, LumSource } from "./geometry";

export type LightSet = {
  colors: ColorSource[];
  lums: LumSource[];
  /** 曲线 SVG 路径的离散点光源，用于影响更高层工具栏 */
  curve: ColorSource[];
  colorGrid: Grid<ColorSource>;
  lumGrid: Grid<LumSource>;
};

export function queryGrid<T>(
  grid: Grid<T>,
  x: number,
  y: number,
  radius: number,
  visit: (entry: T) => void,
): void {
  const cell = grid.cell;
  const minX = Math.floor((x - radius) / cell);
  const maxX = Math.floor((x + radius) / cell);
  const minY = Math.floor((y - radius) / cell);
  const maxY = Math.floor((y + radius) / cell);
  grid.gen++;
  const gen = grid.gen;
  const marks = grid.marks;
  const buckets = grid.buckets;
  const list = grid.list;
  for (let gy = minY; gy <= maxY; gy++) {
    for (let gx = minX; gx <= maxX; gx++) {
      const arr = buckets.get(gy * 100000 + gx);
      if (!arr) continue;
      for (const idx of arr) {
        if (marks[idx] === gen) continue;
        marks[idx] = gen;
        visit(list[idx]);
      }
    }
  }
}

export type CardNode = { el: HTMLElement; accents: HTMLElement[] };

export function sampleColorGrid(
  x: number,
  y: number,
  grid: Grid<ColorSource>,
  radius: number,
  innerOnly = false,
  radiusFor?: (r: DOMRect) => number,
): EdgeSample {
  let wSum = 0;
  let wMax = 0;
  let r = 0;
  let g = 0;
  let b = 0;
  const qr = radius * Math.sqrt(MAX_POWER);
  queryGrid(grid, x, y, qr, (c) => {
    if (innerOnly && !c.inner) return;
    // 黑色/暗色内容不是光源：不参与玻璃染色与高光。
    if (rgbLuminance(c.color) < 60) return;
    const d = c.border ? distToBorder(x, y, c.r) : distToRect(x, y, c.r);
    const p = c.power ?? 1;
    const sr =
      radius * Math.sqrt(p) * (radiusFor ? radiusFor(c.r) : 1);
    if (d >= sr) return;
    const w = Math.pow(1 - d / sr, 2) * p;
    if (w <= 0) return;
    wSum += w;
    if (w > wMax) wMax = w;
    r += c.color.r * w;
    g += c.color.g * w;
    b += c.color.b * w;
  });
  if (wSum <= 0) return null;
  return {
    c: { r: r / wSum, g: g / wSum, b: b / wSum },
    s: Math.min(2.4, wMax),
  };
}

export function sampleLumGrid(
  x: number,
  y: number,
  grid: Grid<LumSource>,
  radius: number,
  radiusFor?: (r: DOMRect) => number,
): { lum: number; prox: number } | null {
  let wSum = 0;
  let lum = 0;
  const qr = radius * Math.sqrt(MAX_POWER);
  queryGrid(grid, x, y, qr, (s) => {
    const d = s.border ? distToBorder(x, y, s.r) : distToRect(x, y, s.r);
    const p = s.power ?? 1;
    const sr =
      radius * Math.sqrt(p) * (radiusFor ? radiusFor(s.r) : 1);
    if (d >= sr) return;
    const w = Math.pow(1 - d / sr, 2) * p;
    if (w <= 0) return;
    wSum += w;
    lum += s.lum * w;
  });
  if (wSum <= 0) return null;
  return { lum: lum / wSum, prox: Math.min(1, wSum / 1.2) };
}

export function roundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export type InnerState = {
  gl: number[];
  sh: number[];
  ir: number[];
  ig: number[];
  ib: number[];
};

export function isToolbar(el: HTMLElement): boolean {
  return el.classList.contains("fx-toolbar");
}

/** 经过所有 overflow 祖先裁切后的可见矩形。 */
export function visibleRectOf(el: HTMLElement, pad = 0): {
  left: number;
  top: number;
  w: number;
  h: number;
} {
  const rect = el.getBoundingClientRect();
  let left = rect.left - pad;
  let top = rect.top - pad;
  let right = rect.right + pad;
  let bottom = rect.bottom + pad;
  let parent = el.parentElement;
  while (parent) {
    const cs = getComputedStyle(parent);
    const clipX = cs.overflowX !== "visible";
    const clipY = cs.overflowY !== "visible";
    if (clipX || clipY) {
      const pr = parent.getBoundingClientRect();
      const pl = pr.left + parent.clientLeft;
      const pt = pr.top + parent.clientTop;
      const prr = pl + parent.clientWidth;
      const pb = pt + parent.clientHeight;
      if (clipX) {
        left = Math.max(left, pl);
        right = Math.min(right, prr);
      }
      if (clipY) {
        top = Math.max(top, pt);
        bottom = Math.min(bottom, pb);
      }
    }
    parent = parent.parentElement;
  }
  return {
    left,
    top,
    w: Math.max(0, right - left),
    h: Math.max(0, bottom - top),
  };
}

/** 工具栏绘制裁切：只按 content 可见范围裁。 */
export function clipToolbar(ctx: CanvasRenderingContext2D, vis: { left: number; top: number; w: number; h: number }): void {
  ctx.beginPath();
  ctx.rect(vis.left, vis.top, vis.w, vis.h);
  ctx.clip();
}

export function dirtyForEls(
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

export function clearDirtyUnion(
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
