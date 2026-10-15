// WebGL 栅格后端（自包含渲染重构 Step 2：工具栏环带原型）。
//
// 语义契约：只消费 samplePanel 的产物——采样/淡入时钟/失效全部由调用方推进，
// 本文件零采样逻辑（染色逻辑不因后端而变）。
//
// 渲染模型（替代 canvas2d 的超采样描边 + 离屏模糊）：
// - 环带条带三角化：几何由点集决定（与 canvas2d 同一套 ringPoints/insetRing），
//   每顶点携带 符号距离/实际半宽/alpha/rgb；条带外扩 3σ+1px 覆盖模糊溢出与抗锯齿。
// - 片元解析衰减：blur(r) 的高斯 ≈ 片元里按 |距离| 直接算 exp 衰减——零模糊 pass。
// - 输出画进共享离屏 WebGL 画布，再由调用方 drawImage 进既有 PanelBuffer——
//   下游（复用窗口、混合层、脏区、贴回）原样不动。
// - 保留 blend 模型（原型阶段不预混色）：与 canvas2d 路径逐像素同语义，视觉对齐；
//   「删混合层」是 Step 3 的事。
import { ST } from "./state";
import { rootColorCached } from "./state";
import {
  edgeShadeAlpha,
  edgeShadeRgb,
  insetRing,
  LINE_ALPHA,
  mapRingToReference,
  MENISCUS_ALPHA,
  MENISCUS_BLUR,
  MENISCUS_HALO_ALPHA,
  MENISCUS_HALO_BLUR,
  MENISCUS_HALO_WIDTH,
  MENISCUS_WIDTH,
  PANEL_PAD,
} from "./geometry";
import { samplePanel, rasterPanel2d } from "./tint";
import type { TintRaster } from "./raster";
import type { Rgb, RingPoint } from "./geometry";

const VS = `
attribute vec2 aPos;   // 缓冲画布设备像素坐标
attribute float aEdge; // ±1：条带左右沿符号
attribute float aSd;   // 带符号距离（含 3σ 模糊外扩），设备像素
attribute float aHalf; // 实际半宽（不含外扩），设备像素
attribute float aAlpha;
attribute vec3 aRgb;
varying float vSd;
varying float vHalf;
varying float vAlpha;
varying vec3 vRgb;
varying vec2 vPos;
void main() {
  vSd = aSd;
  vHalf = aHalf;
  vAlpha = aAlpha;
  vRgb = aRgb;
  vPos = aPos;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FS = `
precision mediump float;
varying float vSd;
varying float vHalf;
varying float vAlpha;
varying vec3 vRgb;
varying vec2 vPos;
uniform float uSigma;    // 高斯 σ（设备像素；canvas2d blur(r) ≈ σ=r/2）
uniform float uClipUse;  // >0.5：裁到面板圆角矩形内部（内光/暗部用）
uniform vec4 uClipRect;  // 面板区域（缓冲画布设备像素坐标）
uniform float uClipRadius;
float sdRoundRect(vec2 p, vec4 r, float rad) {
  vec2 d = abs(p - r.xy) - (r.zw - vec2(rad));
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - rad;
}
void main() {
  if (uClipUse > 0.5 && sdRoundRect(vPos, uClipRect, uClipRadius) > 0.0) discard;
  float d = abs(vSd);
  float body = d <= vHalf
    ? 1.0
    : exp(-((d - vHalf) * (d - vHalf)) / (2.0 * uSigma * uSigma + 0.0001));
  // 边缘1.5px 抗锯齿覆盖（替代 canvas2d 的超采样描边）
  float cover = clamp((vHalf + 0.75 - d) / 1.5, 0.0, 1.0);
  float a = vAlpha * body * cover;
  if (a <= 0.003) discard;
  gl_FragColor = vec4(vRgb, a);
}`;

interface Band {
  pts: RingPoint[];
  widthAt: (i: number) => number;
  alphaAt: (i: number) => number;
  colorAt: (i: number) => Rgb;
  sigma: number;
  clip: boolean;
}

let glCanvas: HTMLCanvasElement | null = null;
let gl: WebGLRenderingContext | null = null;
let prog: WebGLProgram | null = null;
let buf: WebGLBuffer | null = null;
let locs: Record<string, WebGLUniformLocation | null> = {};
let lost = false;

function ensureGl(): WebGLRenderingContext | null {
  if (gl && !lost) return gl;
  if (!glCanvas) {
    glCanvas = document.createElement("canvas");
    glCanvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      lost = true;
      // 上下文丢失：所有已渲染内容失效，代数 +1 触发全量重画
      ST.bufGen += 1;
    });
  }
  const g = glCanvas.getContext("webgl", {
    alpha: true,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true,
    antialias: false,
  });
  if (!g) return null;
  gl = g;
  lost = false;
  const compile = (type: number, src: string) => {
    const sh = g.createShader(type)!;
    g.shaderSource(sh, src);
    g.compileShader(sh);
    return sh;
  };
  prog = g.createProgram()!;
  g.attachShader(prog, compile(g.VERTEX_SHADER, VS));
  g.attachShader(prog, compile(g.FRAGMENT_SHADER, FS));
  g.linkProgram(prog);
  buf = g.createBuffer();
  locs = {
    uSigma: g.getUniformLocation(prog, "uSigma"),
    uClipUse: g.getUniformLocation(prog, "uClipUse"),
    uClipRect: g.getUniformLocation(prog, "uClipRect"),
    uClipRadius: g.getUniformLocation(prog, "uClipRadius"),
  };
  g.enable(g.BLEND);
  g.blendFunc(g.SRC_ALPHA, g.ONE_MINUS_SRC_ALPHA);
  return g;
}

const STRIDE = 9; // pos2 + edge + sd + half + alpha + rgb3

/** 由环带点集构建条带三角网格（逐段、逐点外扩 3σ+1px）。 */
function buildStrip(
  pts: RingPoint[],
  band: Band,
  dpr: number,
  ox: number,
  oy: number,
): Float32Array {
  const verts: number[] = [];
  const n = pts.length;
  // 按 brk 切段：段内才共享切线
  let segStart = 0;
  const flush = (s: number, e: number) => {
    if (e - s < 1) return;
    for (let i = s; i <= e; i++) {
      const p = pts[i];
      const prev = pts[Math.max(s, i - 1)];
      const next = pts[Math.min(e, i + 1)];
      let dx = next.x - prev.x;
      let dy = next.y - prev.y;
      const len = Math.hypot(dx, dy) || 1;
      dx /= len;
      dy /= len;
      const nx = -dy;
      const ny = dx;
      const a = band.alphaAt(i);
      if (a <= 0.003) continue;
      const c = band.colorAt(i);
      const half = (band.widthAt(i) / 2) * dpr;
      const ext = half + 3 * band.sigma * dpr + 1;
      const px = (p.x - ox) * dpr;
      const py = (p.y - oy) * dpr;
      const rgb = [c.r / 255, c.g / 255, c.b / 255];
      // 左沿 (+1)
      verts.push(
        px + nx * ext,
        py + ny * ext,
        1,
        ext,
        half,
        a,
        rgb[0],
        rgb[1],
        rgb[2],
      );
      // 右沿 (-1)
      verts.push(
        px - nx * ext,
        py - ny * ext,
        -1,
        ext,
        half,
        a,
        rgb[0],
        rgb[1],
        rgb[2],
      );
    }
  };
  for (let i = 0; i < n; i++) {
    if (pts[i].brk && i > segStart) {
      flush(segStart, i - 1);
      segStart = i;
    }
  }
  flush(segStart, n - 1);
  return new Float32Array(verts);
}

function drawBand(
  g: WebGLRenderingContext,
  band: Band,
  dpr: number,
  ox: number,
  oy: number,
  clipRect: { x: number; y: number; w: number; h: number; r: number },
): void {
  // 与 strokeChunkBand 一致：整带最大 alpha ≤0.003 则整带跳过
  let maxA = 0;
  for (let i = 0; i < band.pts.length; i++) {
    const a = band.alphaAt(i);
    if (a > maxA) maxA = a;
  }
  if (maxA <= 0.003) return;
  const data = buildStrip(band.pts, band, dpr, ox, oy);
  if (!data.length) return;
  g.bindBuffer(g.ARRAY_BUFFER, buf!);
  g.bufferData(g.ARRAY_BUFFER, data, g.DYNAMIC_DRAW);
  const B = STRIDE * 4;
  const attr = (name: string, size: number, offset: number) => {
    const loc = g.getAttribLocation(prog!, name);
    if (loc >= 0) {
      g.enableVertexAttribArray(loc);
      g.vertexAttribPointer(loc, size, g.FLOAT, false, B, offset);
    }
  };
  attr("aPos", 2, 0);
  attr("aEdge", 1, 8);
  attr("aSd", 1, 12);
  attr("aHalf", 1, 16);
  attr("aAlpha", 1, 20);
  attr("aRgb", 3, 24);
  g.uniform1f(locs.uSigma, Math.max(0.01, band.sigma * dpr));
  g.uniform1f(locs.uClipUse, band.clip ? 1 : 0);
  g.uniform4f(locs.uClipRect, clipRect.x, clipRect.y, clipRect.w, clipRect.h);
  g.uniform1f(locs.uClipRadius, clipRect.r);
  g.drawArrays(g.TRIANGLES, 0, data.length / STRIDE);
}

/**
 * 栅格入口（TintRaster）：采样（语义共用）→ 条带绘制 → blit 进 PanelBuffer。
 */
export const glTintRaster: TintRaster = {
  id: "webgl",
  drawPanel(el, ctx2, shadeCtx2, cards, frameScale) {
    const s = samplePanel(el, cards, frameScale);
    if (!s) return;
    const g = ensureGl();
    if (!g || !prog) {
      // WebGL 不可用：静默回退 canvas2d 栅格（采样产物同一份，语义一致）
      rasterPanel2d(s, ctx2, shadeCtx2);
      return;
    }
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const {
      rect,
      corner,
      pts,
      mainPts,
      st,
      ist,
      toolFade,
      glowAlpha,
      litAt,
      tintAt,
    } = s;
    const w = rect.width + PANEL_PAD * 2;
    const h = rect.height + PANEL_PAD * 2;
    const gw = Math.max(1, Math.ceil(w * dpr));
    const gh = Math.max(1, Math.ceil(h * dpr));
    if (glCanvas!.width !== gw) glCanvas!.width = gw;
    if (glCanvas!.height !== gh) glCanvas!.height = gh;
    g.viewport(0, 0, gw, gh);
    g.clearColor(0, 0, 0, 0);
    g.clear(g.COLOR_BUFFER_BIT);
    const ox = rect.left - PANEL_PAD;
    const oy = rect.top - PANEL_PAD;
    const clipRect = {
      x: PANEL_PAD * dpr,
      y: PANEL_PAD * dpr,
      w: rect.width * dpr,
      h: rect.height * dpr,
      r: corner * dpr,
    };
    const darkRgb = rootColorCached("edgeShade", edgeShadeRgb);
    const darkAlpha = edgeShadeAlpha() * glowAlpha;
    const darkPts = insetRing(rect, corner, 1.4);
    const mapDark = mapRingToReference(darkPts, mainPts);

    // ── glow 层条带（与 canvas2d 栅格段逐项同参）──
    g.bindFramebuffer(g.FRAMEBUFFER, null);
    const glowBands: Band[] = [
      {
        pts,
        widthAt: () => 1,
        alphaAt: (i) => st.a[i] * LINE_ALPHA * toolFade,
        colorAt: (i) => ({ r: st.r[i], g: st.g[i], b: st.b[i] }),
        sigma: 0.3,
        clip: false,
      },
      {
        pts,
        widthAt: () => 2.6,
        alphaAt: (i) => Math.pow(st.a[i] / 2.4, 2) * 0.26 * toolFade,
        colorAt: (i) => ({ r: st.r[i], g: st.g[i], b: st.b[i] }),
        sigma: 0.3,
        clip: false,
      },
      {
        pts,
        widthAt: () => 3,
        alphaAt: (i) => st.a[i] * LINE_ALPHA * 0.3 * glowAlpha * toolFade,
        colorAt: (i) => ({ r: st.r[i], g: st.g[i], b: st.b[i] }),
        sigma: MENISCUS_BLUR / 2,
        clip: true,
      },
      {
        pts: mainPts,
        widthAt: (i) => Math.max(0.6, MENISCUS_WIDTH * (0.3 + 0.85 * litAt(i))),
        alphaAt: (i) => litAt(i) * MENISCUS_ALPHA * glowAlpha * toolFade,
        colorAt: tintAt,
        sigma: MENISCUS_BLUR / 2,
        clip: false,
      },
      {
        pts: mainPts,
        widthAt: (i) =>
          Math.max(0.5, MENISCUS_HALO_WIDTH * Math.pow(litAt(i), 1.25)),
        alphaAt: (i) =>
          Math.pow(litAt(i), 2) * MENISCUS_HALO_ALPHA * glowAlpha * toolFade,
        colorAt: tintAt,
        sigma: MENISCUS_HALO_BLUR / 2,
        clip: false,
      },
    ];
    for (const band of glowBands) drawBand(g, band, dpr, ox, oy, clipRect);
    ctx2.drawImage(
      glCanvas!,
      0,
      0,
      glCanvas!.width,
      glCanvas!.height,
      ox,
      oy,
      w,
      h,
    );
    // ── dark 层（清屏后单独一轮）──
    g.clear(g.COLOR_BUFFER_BIT);
    const darkBand: Band = {
      pts: darkPts,
      widthAt: () => 1.8,
      alphaAt: (i) =>
        Math.pow(ist.sh[mapDark[i] ?? 0], 1.3) * darkAlpha * toolFade,
      colorAt: () => darkRgb,
      sigma: 1.6 / 2,
      clip: true,
    };
    drawBand(g, darkBand, dpr, ox, oy, clipRect);
    shadeCtx2.drawImage(
      glCanvas!,
      0,
      0,
      glCanvas!.width,
      glCanvas!.height,
      ox,
      oy,
      w,
      h,
    );
  },
};
