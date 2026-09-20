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