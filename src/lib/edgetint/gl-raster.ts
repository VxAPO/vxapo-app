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
  ringPoints,
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
// 像素 → NDC：x' = x*(2/W)-1，y' = 1-y*(2/H)（y 轴翻转）
uniform vec2 uScale;
uniform vec2 uOff;
void main() {
  vSd = aSd;
  vHalf = aHalf;
  vAlpha = aAlpha;
  vRgb = aRgb;
  vPos = aPos;
  gl_Position = vec4(aPos * uScale + uOff, 0.0, 1.0);
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
// Abramowitz–Stegun 7.1.26（|误差|<1.5e-7）：box⊗gauss 需要两次 erf
float erf(float x) {
  float s = x < 0.0 ? -1.0 : 1.0;
  x = abs(x);
  float t = 1.0 / (1.0 + 0.3275911 * x);
  float y = 1.0 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t
    - 0.284496736) * t + 0.254829592) * t * exp(-x * x);
  return s * y;
}
void main() {
  if (uClipUse > 0.5 && sdRoundRect(vPos, uClipRect, uClipRadius) > 0.0) discard;
  float d = abs(vSd);
  // 精确复刻 canvas2d 的「宽 2h 描边 × 高斯模糊 σ」合成轮廓 = box⊗gauss：
  //   A(d) = ½[erf((h−d)/(σ√2)) + erf((h+d)/(σ√2))]
  // 曾用「平顶 + 高斯肩」分段函数：宽条带（halo 宽至 8px）的平顶边缘在多条带
  // 叠加时呈台阶感；box⊗gauss 全程 C∞，细描边带（σ=0.3）自然退化为带 AA 的细线。
  float s2 = 1.41421356 * max(uSigma, 0.15);
  float a = vAlpha * 0.5 * (erf((vHalf - d) / s2) + erf((vHalf + d) / s2));
  if (a <= 0.003) discard;
  // 预乘输出：配合 blendFunc(ONE, ONE_MINUS_SRC_ALPHA) 与 premultipliedAlpha:true。
  // 曾用非预乘 + (SRC_ALPHA, ONE_MINUS_SRC_ALPHA)：alpha 通道被同样混合成 a²，
  // 颜色再被浏览器乘一次 alpha → 层内容又黑又淡（maxA 15/255）不可见。
  gl_FragColor = vec4(vRgb * a, a);
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
    premultipliedAlpha: true,
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
    if (!g.getShaderParameter(sh, g.COMPILE_STATUS)) {
      console.error("[edgeTint/gl] shader 编译失败:", g.getShaderInfoLog(sh));
    }
    return sh;
  };
  prog = g.createProgram()!;
  g.attachShader(prog, compile(g.VERTEX_SHADER, VS));
  g.attachShader(prog, compile(g.FRAGMENT_SHADER, FS));
  g.linkProgram(prog);
  if (!g.getProgramParameter(prog, g.LINK_STATUS)) {
    console.error("[edgeTint/gl] 程序链接失败:", g.getProgramInfoLog(prog));
  }
  buf = g.createBuffer();
  locs = {
    uScale: g.getUniformLocation(prog, "uScale"),
    uOff: g.getUniformLocation(prog, "uOff"),
    uSigma: g.getUniformLocation(prog, "uSigma"),
    uClipUse: g.getUniformLocation(prog, "uClipUse"),
    uClipRect: g.getUniformLocation(prog, "uClipRect"),
    uClipRadius: g.getUniformLocation(prog, "uClipRadius"),
  };
  g.enable(g.BLEND);
  // 预乘 alpha 的标准 over：多条带在同一画布上依次叠加也语义正确
  g.blendFunc(g.ONE, g.ONE_MINUS_SRC_ALPHA);
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
): { data: Float32Array; segs: Array<{ start: number; count: number }> } {
  const verts: number[] = [];
  const segs: Array<{ start: number; count: number }> = [];
  const n = pts.length;
  const emit = (i: number, prevIdx: number, nextIdx: number) => {
    const p = pts[i];
    const prev = pts[prevIdx];
    const next = pts[nextIdx];
    let dx = next.x - prev.x;
    let dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    const nx = -dy;
    const ny = dx;
    // alpha=0 的点也必须占位：跳过会让条带跨接成弦，闭合环跨角的弦
    // 切进环内（sd≈0 → 满 alpha）——曾出现贯穿面板的对角亮带。
    // 片元里 a<=0.003 会 discard，零 alpha 顶点只是几何占位。
    const a = band.alphaAt(i);
    const c = band.colorAt(i);
    const half = (band.widthAt(i) / 2) * dpr;
    const ext = half + 3 * band.sigma * dpr + 1;
    const px = (p.x - ox) * dpr;
    const py = (p.y - oy) * dpr;
    const rgb = [c.r / 255, c.g / 255, c.b / 255];
    // 左沿 (+1)：符号距离 +ext
    verts.push(px + nx * ext, py + ny * ext, 1, ext, half, a, rgb[0], rgb[1], rgb[2]);
    // 右沿 (-1)：符号距离必须是 -ext（曾误写 +ext，整条带 sd 恒正 → 全部 discard）
    verts.push(px - nx * ext, py - ny * ext, -1, -ext, half, a, rgb[0], rgb[1], rgb[2]);
  };
  // 闭合环（ringPoints/insetRing 产物首尾同点）：单条带绕环一周，切线用环回
  // 中心差分——圆角矩形直边→圆弧本就切向连续，brk 处不再切断，两段端帽
  // 对顶留下的接缝竖线随之消失。
  const closed =
    n > 3 &&
    Math.abs(pts[0].x - pts[n - 1].x) < 1e-4 &&
    Math.abs(pts[0].y - pts[n - 1].y) < 1e-4;
  if (closed) {
    const m = n - 1; // 去掉重复的闭合点，环回取邻居
    for (let i = 0; i < m; i++) {
      emit(i, i === 0 ? m - 1 : i - 1, i === m - 1 ? 0 : i + 1);
    }
    // 封口：TRIANGLE_STRIP 是线性序列不会自动环回——重复前两对顶点，
    // 让末段（pts[m-1]→pts[0]）也被四边形覆盖。
    emit(0, m - 1, 1);
    emit(1, 0, 2);
    const count = verts.length / STRIDE;
    if (count >= 4) segs.push({ start: 0, count });
    return { data: new Float32Array(verts), segs };
  }
  // 开放折线：按 brk 切段，段内才共享切线；每段独立 TRIANGLE_STRIP，
  // 避免跨段连接出垃圾四边形。
  let segStart = 0;
  const flush = (s: number, e: number) => {
    if (e - s < 1) return;
    const startVertex = verts.length / STRIDE;
    const before = verts.length;
    for (let i = s; i <= e; i++) {
      emit(i, Math.max(s, i - 1), Math.min(e, i + 1));
    }
    const count = (verts.length - before) / STRIDE;
    if (count >= 3) segs.push({ start: startVertex, count });
  };
  for (let i = 0; i < n; i++) {
    if (pts[i].brk && i > segStart) {
      flush(segStart, i - 1);
      segStart = i;
    }
  }
  flush(segStart, n - 1);
  return { data: new Float32Array(verts), segs };
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
  const { data, segs } = buildStrip(band.pts, band, dpr, ox, oy);
  if (!segs.length) return;
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
  for (const seg of segs) {
    g.drawArrays(g.TRIANGLE_STRIP, seg.start, seg.count);
  }
  // 调试追踪（__vxGLTrace 数组存在时）：逐带记录 GL 错误码与规模
  {
    const t = (globalThis as { __vxGLTrace?: unknown[] }).__vxGLTrace;
    if (t)
      t.push({
        op: "band",
        err: g.getError(),
        segs: segs.length,
        verts: data.length / STRIDE,
        v0: Array.from(data.subarray(0, 9)),
      });
  }
}

/**
 * 栅格入口（TintRaster）：采样（语义共用）→ 条带绘制 → blit 进 PanelBuffer。
 */
/** 调试回放：用真实条带管线画一个合成矩形环并读回（隔离 数据 vs 绘制路径）。 */
export function __glReplay(): {
  nzStripHard: number;
  nzStrip: number;
  nzTri: number;
  err: number;
  segs: number;
  v0: number[];
} | null {
  const g = ensureGl();
  if (!g || !prog) return null;
  const gw = (glCanvas!.width = 256);
  const gh = (glCanvas!.height = 128);
  g.viewport(0, 0, gw, gh);
  g.useProgram(prog);
  g.uniform2f(locs.uScale, 2 / gw, -2 / gh);
  g.uniform2f(locs.uOff, -1, 1);
  g.clearColor(0, 0, 0, 0);
  g.clear(g.COLOR_BUFFER_BIT);
  // 合成矩形环（借 ringPoints 造点集）
  const pts = ringPoints(20, 20, 236, 108, 12);
  const band: Band = {
    pts,
    widthAt: () => 3,
    alphaAt: () => 1,
    colorAt: () => ({ r: 255, g: 128, b: 32 }),
    sigma: 0.3,
    clip: false,
  };
  const { data, segs } = buildStrip(pts, band, 1, 0, 0);
  const setupAttrs = () => {
    g.bindBuffer(g.ARRAY_BUFFER, buf!);
    g.bufferData(g.ARRAY_BUFFER, data, g.DYNAMIC_DRAW);
    const B = STRIDE * 4;
    const attr = (name: string, size: number, off: number) => {
      const loc = g.getAttribLocation(prog!, name);
      if (loc >= 0) {
        g.enableVertexAttribArray(loc);
        g.vertexAttribPointer(loc, size, g.FLOAT, false, B, off);
      }
    };
    attr("aPos", 2, 0);
    attr("aEdge", 1, 8);
    attr("aSd", 1, 12);
    attr("aHalf", 1, 16);
    attr("aAlpha", 1, 20);
    attr("aRgb", 3, 24);
  };
  const readNz = () => {
    const px = new Uint8Array(gw * gh * 4);
    g.readPixels(0, 0, gw, gh, g.RGBA, g.UNSIGNED_BYTE, px);
    let nz = 0;
    for (let i = 3; i < px.length; i += 4) if (px[i] !== 0) nz++;
    return nz;
  };
  g.uniform1f(locs.uSigma, Math.max(0.01, band.sigma));
  g.uniform1f(locs.uClipUse, 0);
  g.uniform4f(locs.uClipRect, 0, 0, 0, 0);
  g.uniform1f(locs.uClipRadius, 0);
  // ① 硬编码条带（自检同款数值 + STRIP 拓扑 + 4 顶点）
  const stripData = new Float32Array([
    10, 10, 1, 2, 4, 1, 1, 0, 0,
    50, 10, -1, 2, 4, 1, 1, 0, 0,
    10, 50, 1, 2, 4, 1, 1, 0, 0,
    50, 50, -1, 2, 4, 1, 1, 0, 0,
  ]);
  g.bindBuffer(g.ARRAY_BUFFER, buf!);
  g.bufferData(g.ARRAY_BUFFER, stripData, g.DYNAMIC_DRAW);
  {
    const B = STRIDE * 4;
    const attr = (name: string, size: number, off: number) => {
      const loc = g.getAttribLocation(prog!, name);
      if (loc >= 0) {
        g.enableVertexAttribArray(loc);
        g.vertexAttribPointer(loc, size, g.FLOAT, false, B, off);
      }
    };
    attr("aPos", 2, 0);
    attr("aEdge", 1, 8);
    attr("aSd", 1, 12);
    attr("aHalf", 1, 16);
    attr("aAlpha", 1, 20);
    attr("aRgb", 3, 24);
  }
  g.drawArrays(g.TRIANGLE_STRIP, 0, 4);
  const nzStripHard = readNz();
  g.clear(g.COLOR_BUFFER_BIT);
  // ② buildStrip 数据 + 条带拓扑
  setupAttrs();
  const first = segs[0];
  g.drawArrays(g.TRIANGLE_STRIP, first.start, first.count);
  const nzStrip = readNz();
  g.clear(g.COLOR_BUFFER_BIT);
  // ② 三角形拓扑（同一份前3顶点）
  g.drawArrays(g.TRIANGLES, 0, 3);
  const nzTri = readNz();
  const err = g.getError();
  return {
    nzStripHard,
    nzStrip,
    nzTri,
    err,
    segs: segs.length,
    v0: Array.from(data.subarray(0, 27)),
  };
}

/** 调试：把共享 GL 画布贴到页面上（截图用），用完调 __glDetachDebug 移除。 */
export function __glAttachDebug(): number {
  if (!glCanvas) return -1;
  glCanvas.style.cssText = `position:fixed;left:0;top:0;width:${glCanvas.width}px;height:${glCanvas.height}px;z-index:99999;opacity:0.6;outline:4px solid red;`;
  if (!glCanvas.parentElement) document.body.appendChild(glCanvas);
  return glCanvas.width * 10000 + glCanvas.height;
}
export function __glDetachDebug(): void {
  glCanvas?.remove();
}

/** 调试自检：用真实 program/blend 画一个硬编码 NDC 三角形并读回非空像素。 */
export function __glSelfTest(): {
  nz: number;
  err: number;
  gw: number;
  gh: number;
} | null {
  const g = ensureGl();
  if (!g || !prog) return null;
  const gw = glCanvas!.width || 64;
  const gh = glCanvas!.height || 64;
  g.viewport(0, 0, gw, gh);
  g.useProgram(prog);
  g.uniform2f(locs.uScale, 2 / gw, -2 / gh);
  g.uniform2f(locs.uOff, -1, 1);
  g.uniform1f(locs.uSigma, 0.5);
  g.uniform1f(locs.uClipUse, 0);
  g.uniform4f(locs.uClipRect, 0, 0, 0, 0);
  g.uniform1f(locs.uClipRadius, 0);
  g.clearColor(0, 0, 0, 0);
  g.clear(g.COLOR_BUFFER_BIT);
  // 覆盖画布左下角区域的直角三角形
  const data = new Float32Array([
    2, gh - 2, 1, 2, 4, 1, 1, 0, 0,
    gw - 2, gh - 2, 1, 2, 4, 1, 0, 1, 0,
    2, 2, 1, 2, 4, 1, 0, 0, 1,
  ]);
  g.bindBuffer(g.ARRAY_BUFFER, buf!);
  g.bufferData(g.ARRAY_BUFFER, data, g.DYNAMIC_DRAW);
  const B = STRIDE * 4;
  const attr = (name: string, size: number, off: number) => {
    const loc = g.getAttribLocation(prog!, name);
    if (loc >= 0) {
      g.enableVertexAttribArray(loc);
      g.vertexAttribPointer(loc, size, g.FLOAT, false, B, off);
    }
  };
  attr("aPos", 2, 0);
  attr("aEdge", 1, 8);
  attr("aSd", 1, 12);
  attr("aHalf", 1, 16);
  attr("aAlpha", 1, 20);
  attr("aRgb", 3, 24);
  g.drawArrays(g.TRIANGLES, 0, 3);
  const err = g.getError();
  const px = new Uint8Array(gw * gh * 4);
  g.readPixels(0, 0, gw, gh, g.RGBA, g.UNSIGNED_BYTE, px);
  let nz = 0;
  for (let i = 3; i < px.length; i += 4) if (px[i] !== 0) nz++;
  return { nz, err, gw, gh };
}

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
    g.useProgram(prog);
    g.clearColor(0, 0, 0, 0);
    g.clear(g.COLOR_BUFFER_BIT);
    // 像素→NDC 变换（y 翻转）：每次按画布尺寸设置
    g.uniform2f(locs.uScale, 2 / gw, -2 / gh);
    g.uniform2f(locs.uOff, -1, 1);
    const ox = rect.left - PANEL_PAD;
    const oy = rect.top - PANEL_PAD;
    // 片元侧 sdRoundRect 语义：xy = 中心，zw = 半尺寸
    const clipRect = {
      x: PANEL_PAD * dpr + (rect.width * dpr) / 2,
      y: PANEL_PAD * dpr + (rect.height * dpr) / 2,
      w: (rect.width * dpr) / 2,
      h: (rect.height * dpr) / 2,
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
    g.flush();
    // 调试探针（提前到 blit 前）：确认条带绘制是否真的产生像素
    {
      const t = (globalThis as { __vxGLTrace?: unknown[] }).__vxGLTrace;
      if (t) {
        const px = new Uint8Array(gw * gh * 4);
        g.readPixels(0, 0, gw, gh, g.RGBA, g.UNSIGNED_BYTE, px);
        let nz = 0;
        for (let i = 3; i < px.length; i += 4) if (px[i] !== 0) nz++;
        t.push({ op: "preBlitReadback", nz, gw, gh });
      }
    }
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
    // 调试探针：blit 前读回 GL 画布，确认 glow 内容是否真实存在
    {
      const t = (globalThis as { __vxGLTrace?: unknown[] }).__vxGLTrace;
      if (t) {
        const px = new Uint8Array(gw * gh * 4);
        g.readPixels(0, 0, gw, gh, g.RGBA, g.UNSIGNED_BYTE, px);
        let nz = 0;
        for (let i = 3; i < px.length; i += 4) if (px[i] !== 0) nz++;
        t.push({
          op: "glowReadback",
          nz,
          gw,
          gh,
          scale: Array.from(g.getUniform(prog!, locs.uScale!) as Float32Array),
          off: Array.from(g.getUniform(prog!, locs.uOff!) as Float32Array),
          progOk: g.getParameter(g.CURRENT_PROGRAM) === prog,
        });
      }
    }
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
