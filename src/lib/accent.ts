import type { CSSProperties } from "react";

/**
 * 深色 hover 外圈色：OKLCH L*0.75，C 不变，
 * H 按 RGB 感知公式微调——G 感知占比越高，越向绿基色相（142.5°）靠一点；
 * R/B 感知弱时不动，避免压暗后发灰或过暗。
 * 固定配色直接查表，自定义色运行时算好后以 hex 注入 CSS。
 */
export const ACCENT_HOVER_HEX: Record<string, string> = {
  "#da5788": "#a3215a",
  "#df5770": "#a71f43",
  "#e15957": "#a92129",
  "#e05d40": "#a82704",
  "#dd6222": "#9b3c00",
  "#d76a00": "#924600",
  "#cd7300": "#8b4c00",
  "#798e11": "#4c6000",
  "#519741": "#21690d",
  "#009c65": "#00693f",
  "#00a58d": "#006f5a",
  "#00a3a5": "#006e6a",
  "#00a4c1": "#006f7b",
  "#009dd4": "#006b85",
  "#0096e2": "#00688b",
  "#358fe9": "#006496",
  "#6082e9": "#1e56b3",
  "#8078e5": "#4f4ab2",
  "#996fda": "#6b3fa6",
  "#ae67c9": "#7d3796",
  "#c360bc": "#8f2e8a",
  "#d05ba5": "#9a2774",
  "#d8588f": "#a12260",
  "#de5778": "#a6204b",
  "#47c3d1": "#00878b",
  "#009aa2": "#006868",
};

/** 深色模式显示用：基础色 OKLCH L 拉到 0.6，C/H 不变；hover 再按浅色同一套算法算一遍 */
export const ACCENT_DARK_HEX: Record<string, { base: string; hover: string }> = {
  "#da5788": { base: "#cc4a7c", hover: "#981351" },
  "#df5770": { base: "#d14a64", hover: "#9d113b" },
  "#e15957": { base: "#d34c4b", hover: "#9f1320" },
  "#e05d40": { base: "#d25033", hover: "#9b2100" },
  "#dd6222": { base: "#cf550c", hover: "#8d3600" },
  "#d76a00": { base: "#c46000", hover: "#853f00" },
  "#cd7300": { base: "#bb6800", hover: "#7e4400" },
  "#798e11": { base: "#768b0a", hover: "#4a5e00" },
  "#519741": { base: "#4e943e", hover: "#1e6709" },
  "#009c65": { base: "#009862", hover: "#00663d" },
  "#00a58d": { base: "#00957f", hover: "#006451" },
  "#00a3a5": { base: "#009394", hover: "#00635e" },
  "#00a4c1": { base: "#008fa9", hover: "#00616b" },
  "#009dd4": { base: "#008bbd", hover: "#005f76" },
  "#0096e2": { base: "#0088cd", hover: "#005e7d" },
  "#358fe9": { base: "#2582db", hover: "#005b8a" },
  "#6082e9": { base: "#5778de", hover: "#184fab" },
  "#8078e5": { base: "#776fdb", hover: "#4943aa" },
  "#996fda": { base: "#9066d0", hover: "#65389f" },
  "#ae67c9": { base: "#a45ebf", hover: "#76308f" },
  "#c360bc": { base: "#b654af", hover: "#852480" },
  "#d05ba5": { base: "#c24e99", hover: "#901b6c" },
  "#d8588f": { base: "#ca4b83", hover: "#971558" },
  "#de5778": { base: "#d04a6c", hover: "#9c1142" },
  "#47c3d1": { base: "#00919e", hover: "#006265" },
  "#009aa2": { base: "#009299", hover: "#006262" },
};

function srgbToLinear(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function linearToSrgb(v: number): number {
  const c = Math.max(0, Math.min(1, v));
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace("#", "").trim();
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  h = h.padEnd(6, "0").slice(0, 6);
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  const to = (v: number) =>
    Math.max(0, Math.min(255, Math.round(linearToSrgb(v) * 255)))
      .toString(16)
      .padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

function rgbToOklch(
  r: number,
  g: number,
  b: number,
): [number, number, number] {
  const rl = srgbToLinear(r);
  const gl = srgbToLinear(g);
  const bl = srgbToLinear(b);
  const l = 0.4122214708 * rl + 0.5363325363 * gl + 0.0514459929 * bl;
  const m = 0.2119034982 * rl + 0.6806995451 * gl + 0.1073969566 * bl;
  const s = 0.0883024619 * rl + 0.2817188376 * gl + 0.6299787005 * bl;
  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);
  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const aAxis = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const bAxis = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;
  const C = Math.hypot(aAxis, bAxis);
  let H = (Math.atan2(bAxis, aAxis) * 180) / Math.PI;
  if (H < 0) H += 360;
  return [L, C, H];
}

function oklchToLinearRgb(
  L: number,
  C: number,
  H: number,
): [number, number, number] {
  const h = (H * Math.PI) / 180;
  const aAxis = C * Math.cos(h);
  const bAxis = C * Math.sin(h);
  const l_ = L + 0.3963377774 * aAxis + 0.2158037573 * bAxis;
  const m_ = L - 0.1055613458 * aAxis - 0.0638541728 * bAxis;
  const s_ = L - 0.0894841775 * aAxis - 1.291485548 * bAxis;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const b = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return [r, g, b];
}

function isInGamut(rgb: [number, number, number]): boolean {
  return rgb.every((v) => v >= 0 && v <= 1);
}

/**
 * OKLCH 转 sRGB 时保持 L/H 不变，仅缩小 C 到 sRGB 色域内。
 * 避免直接 clamp 导致红色通道被截断后色相偏移（橙变红）。
 */
function oklchToRgb(
  L: number,
  C: number,
  H: number,
): [number, number, number] {
  if (isInGamut(oklchToLinearRgb(L, C, H))) {
    return oklchToLinearRgb(L, C, H);
  }
  let lo = 0;
  let hi = C;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (isInGamut(oklchToLinearRgb(L, mid, H))) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return oklchToLinearRgb(L, lo, H);
}

function computeAccentHover(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  const rl = srgbToLinear(r);
  const gl = srgbToLinear(g);
  const bl = srgbToLinear(b);
  const lum = rl * 0.2126 + gl * 0.7152 + bl * 0.0722;
  const gPer = lum > 0 ? (gl * 0.7152) / lum : 0;

  const [L, C, H] = rgbToOklch(r, g, b);
  const L2 = L * 0.75;
  const C2 = C;

  // G 感知占比高时，向绿基色相 142.5° 微偏；R/B 感知强时不动
  let H2 = H;
  if (gPer > 0.5) {
    const k = Math.min(0.12, (gPer - 0.5) * 0.4);
    H2 = H + (142.5 - H) * k;
  }
  const [rl2, gl2, bl2] = oklchToRgb(L2, C2, H2);
  return rgbToHex(rl2, gl2, bl2);
}

export function accentHoverColor(accent?: string): string | undefined {
  if (!accent) return undefined;
  const key = accent.toLowerCase();
  return ACCENT_HOVER_HEX[key] ?? computeAccentHover(accent);
}

function computeDarkBase(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  const [, C, H] = rgbToOklch(r, g, b);
  const [rl, gl, bl] = oklchToRgb(0.6, C, H);
  return rgbToHex(rl, gl, bl);
}

function computeDarkHover(hex: string): string {
  return computeAccentHover(computeDarkBase(hex));
}

export function accentDarkColor(
  accent?: string,
): { base: string; hover: string } | undefined {
  if (!accent) return undefined;
  const key = accent.toLowerCase();
  return (
    ACCENT_DARK_HEX[key] ??
    { base: computeDarkBase(accent), hover: computeDarkHover(accent) }
  );
}

export interface CardAccentStyle extends CSSProperties {
  "--card-accent"?: string;
  "--card-accent-hover"?: string;
  "--card-accent-dark"?: string;
  "--card-accent-hover-dark"?: string;
}

/** 卡片配色 CSS 变量（浅色/深色基础色与 hover 外圈色都预先算成 hex） */
export function accentStyle(accent?: string): CardAccentStyle | undefined {
  if (!accent) return undefined;
  const hover = accentHoverColor(accent);
  const dark = accentDarkColor(accent);
  return {
    "--card-accent": accent,
    ...(hover ? { "--card-accent-hover": hover } : {}),
    ...(dark
      ? {
          "--card-accent-dark": dark.base,
          "--card-accent-hover-dark": dark.hover,
        }
      : {}),
  };
}

export interface PresetCardStyle extends CSSProperties {
  "--preset-accent"?: string;
  "--preset-accent-hover"?: string;
  "--preset-accent-dark"?: string;
  "--preset-accent-hover-dark"?: string;
}

/** 侧栏预设卡片配色 CSS 变量（浅色/深色基础色与 hover 色都预先算成 hex） */
export function presetCardStyle(accent?: string): PresetCardStyle | undefined {
  if (!accent) return undefined;
  const hover = accentHoverColor(accent);
  const dark = accentDarkColor(accent);
  return {
    "--preset-accent": accent,
    ...(hover ? { "--preset-accent-hover": hover } : {}),
    ...(dark
      ? {
          "--preset-accent-dark": dark.base,
          "--preset-accent-hover-dark": dark.hover,
        }
      : {}),
  };
}

