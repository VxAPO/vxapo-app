// 边缘染色的采样与绘制：颜色/亮度采样、环带与描边、面板离屏绘制（决策 5 阶段 A 第四批，
// 从 hooks/useEdgeTintLayer.ts 原样搬出，行为零变化；状态经 state.ts 的 ST 共享）。

import {
  COLOR_K,
  COVERED_DIM,
  COVERED_INNER_DIM,
  CURVE_RING_DIM,
  FADE_K,
  INNER_SAMPLE_R,
  LINE_ALPHA,
  MAX_SOURCE_R,
  MENISCUS_ALPHA,
  MENISCUS_BLUR,
  MENISCUS_HALO_ALPHA,
  MENISCUS_HALO_BLUR,
  MENISCUS_HALO_WIDTH,
  MENISCUS_INSET,
  MENISCUS_WIDTH,
  RING_GLOW_K,
  SAMPLE_R,
  SHADE_OUT_SMOOTH_R,
  SHADE_SMOOTH_R,
  edgeShadeAlpha,
  edgeShadeRgb,
  insetRing,
  isDark,
  mapRingToReference,
  panelBaseLum,
  panelRectsForTool,
  parseColor,
  ringBaseRgb,
  ringPoints,
  sampleColor,
  scaleK,
  smoothstep,
  strokeChunkBand,
  strokeUniformBand,
} from "./geometry";
import type { ColorSource, Rgb, RingPoint } from "./geometry";
import {
  isToolbar,
  roundedRectPath,
  sampleColorGrid,
  sampleLumGrid,
} from "./primitives";
import type { InnerState, LightSet } from "./primitives";
import { ST, csOf, paintEntryOf, rootColorCached } from "./state";

// 描边亮度路径平滑的可复用缓冲（每采样建数组会在滚动期制造 GC 抖动）
let smoothCum: Float64Array | null = null;
let smoothOut: Float64Array | null = null;
import { ensureSoftCanvas, ensureSsCanvas } from "./canvasPool";

export function curvePointSources(): ColorSource[] {
  const path = document.querySelector<SVGPathElement>(
    ".fx-curve svg path[stroke]",
  );
  if (!path) return [];
  const rect = path.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return [];
  const key = `${rect.width.toFixed(1)}|${rect.height.toFixed(1)}|${
    path.getAttribute("d")?.length ?? 0
  }`;
  const hit = ST.curvePointCache.get(path);
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
  // 步长与点尺寸配成近连续线：曲线是多点光源，稀疏小点会让沿环采样
  // 逐点亮灭（描边染色呈一颗颗亮点）。step10 + 8px 方点 ≈ 首尾相接。
  const STEP = 10;
  for (let d = 0; d <= len; d += STEP) {
    const p = path.getPointAtLength(Math.min(len, d));
    const s = p.matrixTransform(ctm);
    pts.push({
      r: new DOMRect(s.x - 4, s.y - 4, 8, 8),
      power: 1.8,
      inner: true,
      color,
    });
  }
  ST.curvePointCache.set(path, { key, pts });
  return pts;
}

export function cardColor(el: HTMLElement): Rgb | null {
  const hit = ST.colorCache.get(el);
  if (hit && performance.now() - hit.at < 500) return hit.color;
  const cs = csOf(el);
  const darkKey = "--card-accent-dark";
  const lightKey = "--card-accent";
  const accent =
    cs.getPropertyValue(isDark() ? darkKey : lightKey).trim() ||
    cs.getPropertyValue(lightKey).trim();
  const fallbackBrand =
    parseColor(cs.getPropertyValue("--brand").trim()) ||
    rootColorCached("brand", () =>
      parseColor(
        getComputedStyle(document.documentElement)
          .getPropertyValue("--brand")
          .trim(),
      ),
    );
  const color =
    parseColor(accent) ||
    (el.dataset.dndGroup === "effects" || !el.classList.contains("sem-group")
      ? fallbackBrand
      : null);
  ST.colorCache.set(el, { at: performance.now(), color });
  return color;
}

export function stateForRing(el: HTMLElement, n: number) {
  let st = ST.ringStates.get(el);
  if (!st || st.a.length !== n) {
    st = {
      a: new Array(n).fill(0),
      r: new Array(n).fill(128),
      g: new Array(n).fill(128),
      b: new Array(n).fill(128),
    };
    ST.ringStates.set(el, st);
  }
  return st;
}

export function stateForInner(el: HTMLElement, n: number): InnerState {
  let st = ST.innerStates.get(el);
  if (!st || st.gl.length !== n) {
    st = {
      gl: new Array(n).fill(0),
      sh: new Array(n).fill(0),
      ir: new Array(n).fill(255),
      ig: new Array(n).fill(255),
      ib: new Array(n).fill(255),
    };
    ST.innerStates.set(el, st);
  }
  return st;
}

export function strokeHighQualityBand(
  bandCtx: CanvasRenderingContext2D,
  pts: Array<RingPoint>,
  lineWidth: number | ((i: number) => number),
  alphaAt: (i: number) => number,
  colorAt: (i: number) => Rgb,
  toolFade: number,
  scale: number = 4,
): void {
  if (pts.length < 2) return;
  // 运行时二分开关（perf 分支归因用）：__vxSS 覆盖超采样倍率
  const SCALE = (globalThis as { __vxSS?: number }).__vxSS ?? scale;
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
  if (!ST.ssCanvas || !ST.ssCtx) {
    strokeChunkBand(bandCtx, pts, lineWidth, alphaAt, colorAt, toolFade);
    return;
  }
  ST.ssCtx.setTransform(1, 0, 0, 1, 0, 0);
  // 只清本次真正会被读回的窗口：画布会按历史最大尺寸保留，整张清屏纯属浪费
  ST.ssCtx.clearRect(0, 0, ow * SCALE, oh * SCALE);
  ST.ssCtx.setTransform(SCALE, 0, 0, SCALE, -ox * SCALE, -oy * SCALE);
  strokeChunkBand(ST.ssCtx, pts, lineWidth, alphaAt, colorAt, toolFade);
  const smoothing = bandCtx.imageSmoothingEnabled;
  bandCtx.imageSmoothingEnabled = true;
  bandCtx.imageSmoothingQuality = ((globalThis as { __vxSSQ?: string })
    .__vxSSQ ?? "high") as ImageSmoothingQuality;
  bandCtx.drawImage(ST.ssCanvas, 0, 0, ow * SCALE, oh * SCALE, ox, oy, ow, oh);
  bandCtx.imageSmoothingEnabled = smoothing;
}

export function strokeGlowBand(
  bandCtx: CanvasRenderingContext2D,
  pts: Array<RingPoint>,
  lineWidth: number | ((i: number) => number),
  blurPx: number,
  alphaAt: (i: number) => number,
  colorAt: (i: number) => Rgb,
  toolFade: number,
): void {
  // 尖峰归因：每次模糊带绘制计入 blurLast/blurSum（一个 drawPanel 含最多 4 次）
  const t0 = performance.now();
  strokeGlowBandInner(
    bandCtx,
    pts,
    lineWidth,
    blurPx,
    alphaAt,
    colorAt,
    toolFade,
  );
  const dt = performance.now() - t0;
  ST.stats.blurLast += dt;
  ST.stats.blurSum += dt;
}

function strokeGlowBandInner(
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
  if (!ST.softCanvas || !ST.softCtx) {
    const prevFilter = bandCtx.filter;
    bandCtx.filter = `blur(${blurPx}px)`;
    try {
      strokeChunkBand(bandCtx, pts, lineWidth, alphaAt, colorAt, toolFade);
    } finally {
      bandCtx.filter = prevFilter;
    }
    return;
  }
  ST.softCtx.setTransform(1, 0, 0, 1, 0, 0);
  ST.softCtx.clearRect(0, 0, sw, sh);
  // 离屏画布按 DPR 渲染，避免圆角/细线在低分辨率下产生锯齿。
  ST.softCtx.setTransform(dpr, 0, 0, dpr, -ox * dpr, -oy * dpr);
  strokeChunkBand(ST.softCtx, pts, lineWidth, alphaAt, colorAt, toolFade);
  const prevFilter = bandCtx.filter;
  bandCtx.filter = `blur(${blurPx}px)`;
  bandCtx.drawImage(ST.softCanvas, 0, 0, sw, sh, ox, oy, ow, oh);
  bandCtx.filter = prevFilter;
}

/** 采样产物：语义层（淡入状态已推进）与栅格层之间的唯一契约。 */
export interface PanelSample {
  rect: DOMRect;
  corner: number;
  pts: RingPoint[];
  mainPts: RingPoint[];
  st: { a: number[]; r: number[]; g: number[]; b: number[] };
  ist: InnerState;
  toolFade: number;
  glowAlpha: number;
  litAt: (i: number) => number;
  tintAt: (i: number) => Rgb;
  baseRgb: Rgb;
}

/**
 * 面板采样阶段（自包含渲染重构 Step2 拆分，纯代码搬移）：淡入插值、复用
 * 时钟的 frameScale 补偿、光源采样与暗部平滑全部在此推进——canvas2d 与
 * WebGL 栅格后端共用同一份采样，保证「染色逻辑不因后端而变」。
 */
export function samplePanel(
  el: HTMLElement,
  cards: LightSet,
  frameScale = 1,
): PanelSample | null {
  const rect = el.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return null;
  // 本次全量重画的模糊耗时归零累计（strokeGlowBand 逐次累加）
  ST.stats.blurLast = 0;

  const cs = csOf(el);
  const parsedR = parseFloat(cs.borderRadius);
  const corner = Number.isFinite(parsedR) && parsedR > 0 ? parsedR : 16;
  const o = 1;
  const x0 = rect.left - o;
  const y0 = rect.top - o;
  const x1 = rect.right + o;
  const y1 = rect.bottom + o;
  const rc = corner + o;

  const R = MAX_SOURCE_R;
  const nearCurve = cards.curve.filter(
    (c) =>
      c.r.right >= x0 - R &&
      c.r.left <= x1 + R &&
      c.r.bottom >= y0 - R &&
      c.r.top <= y1 + R,
  );
  const tool = isToolbar(el);
  const panels = tool ? panelRectsForTool() : null;
  const toolOverPanel =
    !!panels &&
    panels.length > 0 &&
    panels.some(
      (p) =>
        rect.left < p.right &&
        rect.right > p.left &&
        rect.top < p.bottom &&
        rect.bottom > p.top,
    );
  // 工具栏自带淡入/淡出动画，Canvas 环带直接跟随其透明度，避免退场比工具栏慢
  const toolFade = tool
    ? Math.max(0, Math.min(1, parseFloat(cs.opacity) || 0))
    : 1;
  const glowAlpha = 1;
  // movingTool（快照跟随）：仅滚动中——滚动期工具栏与光源相对几何不变，
  // 染色无真实变化，快照只是防御。框选飞行动画**不走**快照（位置在动但
  // 背景在变，需要0.3 平滑插值——快照曾让它以100ms 顿挫硬跳）。
  const movingTool = tool && ST.scrollingNow;
  // 按时间推进：frameScale=1（正常 33ms 补帧）时与原常数逐字等价；
  // 复用跳帧时按经过的步数放大，保证褪色总时长不变（只是步数更少、每步更大）。
  const scale = Math.max(1, frameScale);
  const fadeK = movingTool ? 1 : scaleK(FADE_K, scale);
  const colorK = movingTool ? 1 : scaleK(COLOR_K, scale);
  // 面板底色：querySelector + 多段样式读取，同一帧同一面板只算一次
  const pe = paintEntryOf(el);
  if (pe.baseLum === undefined) pe.baseLum = panelBaseLum(el);
  const panelBase = pe.baseLum;

  const pts = ringPoints(x0, y0, x1, y1, rc);
  if (pts.length < 2) return null;
  const mainPts = insetRing(rect, corner, MENISCUS_INSET);
  // 本次采样的最大插值残差：> 阈值说明过渡还没收敛，写入 ST.fading 供
  // renderToPanelBuffer 豁免复用（复用会冻结这只时钟，过渡变跳变）。
  let maxDelta = 0;
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
    const curveSample = sampleColor(x, y, nearCurve, SAMPLE_R);
    // 工具栏叠在曲线/设备卡上时，底下的整卡描边/底色已被玻璃模糊，
    // 视觉上仍清晰的只有开关/圆点/chip，因此只采 inner 光源。
    const rawCardSample = sampleColorGrid(
      x,
      y,
      cards.colorGrid,
      SAMPLE_R,
      overPanel,
    );
    // 叠卡时开关/圆点/曲线虽然可见，但隔着玻璃已衰减：强度倍率压低
    const cardSample =
      rawCardSample && overPanel
        ? { ...rawCardSample, s: rawCardSample.s * COVERED_DIM }
        : rawCardSample;
    const curveLit =
      overPanel && curveSample
        ? { ...curveSample, s: curveSample.s * CURVE_RING_DIM }
        : curveSample;
    // 多光混色：强度取最强者（不叠加，防选多爆亮），颜色按强度加权
    // 混合——赢家通吃会在曲线与背景光强度相近处产生色彩突变。
    let sample: { c: Rgb; s: number } | null;
    if (overPanel && curveLit && cardSample) {
      const sa = curveLit.s;
      const sb = cardSample.s;
      sample = {
        s: Math.max(sa, sb),
        c: {
          r: (curveLit.c.r * sa + cardSample.c.r * sb) / (sa + sb),
          g: (curveLit.c.g * sa + cardSample.c.g * sb) / (sa + sb),
          b: (curveLit.c.b * sa + cardSample.c.b * sb) / (sa + sb),
        },
      };
    } else {
      sample = overPanel && curveLit ? curveLit : cardSample;
    }
    const targetA = sample ? sample.s : 0;
    const aDelta = targetA - st.a[i];
    st.a[i] += aDelta * fadeK;
    if (Math.abs(aDelta) > 0.004) ST.fadePending = true;
    if (Math.abs(aDelta) > maxDelta) maxDelta = Math.abs(aDelta);
    const c = sample ? sample.c : null;
    if (c) {
      const fresh = st.a[i] < 0.01 && targetA > 0;
      const k = fresh ? 1 : colorK;
      st.r[i] += (c.r - st.r[i]) * k;
      st.g[i] += (c.g - st.g[i]) * k;
      st.b[i] += (c.b - st.b[i]) * k;
    }
  }
  // 描边亮度沿路径平滑：高强小半径（开关塔）与低强宽半径（边框基底）
  // 并存时，逐点取最强光源会在两者交替主导的区域产生暗亮分层。
  // 与暗部平滑同款的弧长加权窗（12px）抹平沿路径的亮度起伏——
  // 光源的空间分布不变，只让描边的衰减过渡连续。
  {
    const n = st.a.length;
    if (n > 2) {
      let cum = smoothCum;
      let out = smoothOut;
      if (!cum || !out || cum.length < n || out.length < n) {
        cum = smoothCum = new Float64Array(n);
        out = smoothOut = new Float64Array(n);
      }
      cum[0] = 0;
      for (let i = 1; i < n; i++) {
        cum[i] =
          cum[i - 1] +
          Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      }
      const total =
        cum[n - 1] + Math.hypot(pts[0].x - pts[n - 1].x, pts[0].y - pts[n - 1].y);
      const W = 12;
      for (let i = 0; i < n; i++) {
        let sum = st.a[i];
        let wsum = 1;
        for (const dir of [-1, 1]) {
          for (let step = 1; step < n; step++) {
            const j = (i + dir * step + n) % n;
            if (j === i) break;
            const d0 = Math.abs(cum[i] - cum[j]);
            const d = Math.min(d0, total - d0);
            if (d > W) break;
            const wt = 1 - d / W;
            sum += st.a[j] * wt;
            wsum += wt;
          }
        }
        out[i] = sum / wsum;
      }
      for (let i = 0; i < n; i++) st.a[i] = out[i];
    }
  }
  // 内光直接在内圈路径上逐点采样，不再从外圈做序号映射，
  // 圆角处的采样点与绘制点一一对应。
  // 外圈→内圈序号映射：描边染色联动内泛光用（同暗部的映射方式）
  const mapMain = mapRingToReference(mainPts, pts);
  // 曲线内圈采样半径按面板尺度放大：内圈采样点都贴着边，而曲线是从
  // 面板中间穿过的线光源——固定 16px 半径永远够不到（工具栏悬浮在
  // 曲线卡上时内泛光全程看不见曲线的根因）。取面板短边的0.8，
  // 让「线穿过面板中央」也能被边界点采到，且保留位置疏密（离线远的
  // 一侧自然衰减）。
  const curveR = Math.max(
    INNER_SAMPLE_R,
    Math.min(rect.width, rect.height) * 0.8,
  );
  for (let j = 0; j < mainPts.length; j++) {
    const glowP = mainPts[j];
    const lumSample = sampleLumGrid(
      glowP.x,
      glowP.y,
      cards.lumGrid,
      INNER_SAMPLE_R,
      outsideFade,
    );
    const lum = lumSample?.lum ?? panelBase;
    const prox = lumSample?.prox ?? 0;
    // 只有比玻璃更亮的部分才算“光”；暗色滑块/描边不能把玻璃染脏。
    const contrast = Math.max(0, lum - panelBase) / 255;
    const innerTint = sampleColorGrid(
      glowP.x,
      glowP.y,
      cards.colorGrid,
      INNER_SAMPLE_R,
      true,
      outsideFade,
    );
    // 曲线光源：工具栏玻璃盖在曲线卡上时，曲线本身作为 inner 光源参与
    // 内泛光（与环带同规则——仅玻璃覆盖时参与，按玻璃厚度衰减）。
    // 必须短路：无条件采样会让每个内圈点遍历整条曲线点集，视图切换
    // 全量重画时每帧都吃 O(内圈点×曲线点)——实测视图切换掉帧的元凶。
    const curveSample = toolOverPanel
      ? sampleColor(glowP.x, glowP.y, nearCurve, curveR)
      : null;
    const curveLit = curveSample;
    // 多光混色：同环带——强度取 max，颜色按强度加权
    let tint: { c: Rgb; s: number } | null;
    if (innerTint && curveLit) {
      const sa = curveLit.s;
      const sb = innerTint.s;
      tint = {
        s: Math.max(sa, sb),
        c: {
          r: (curveLit.c.r * sa + innerTint.c.r * sb) / (sa + sb),
          g: (curveLit.c.g * sa + innerTint.c.g * sb) / (sa + sb),
          b: (curveLit.c.b * sa + innerTint.c.b * sb) / (sa + sb),
        },
      };
    } else {
      tint = innerTint ?? curveLit;
    }
    const innerFade = toolOverPanel ? COVERED_INNER_DIM : 1;
    const colorEnergy = tint ? Math.min(1, (tint.s * innerFade) / 1.1) : 0;
    const lumEnergy =
      Math.min(1, contrast * 1.6) * Math.pow(prox, 0.8) * innerFade;
    // 描边被染色即出内泛光：外圈 st.a 映射为内光目标的附加项——
    // 不再要求内圈必须采到比玻璃更亮的光源。
    const ringIdx = mapMain[j] ?? 0;
    const ringA = st.a[ringIdx];
    const targetGl = Math.min(
      1,
      colorEnergy + lumEnergy * 0.55 + ringA * RING_GLOW_K,
    );
    rawGl[j] = targetGl;
    if (tint) {
      const kg =
        ist.gl[j] < 0.01 && targetGl > 0
          ? 1
          : movingTool
            ? COLOR_K
            : scaleK(COLOR_K, scale);
      ist.ir[j] += (tint.c.r - ist.ir[j]) * kg;
      ist.ig[j] += (tint.c.g - ist.ig[j]) * kg;
      ist.ib[j] += (tint.c.b - ist.ib[j]) * kg;
    } else if (ringA > 0.02) {
      // 内圈无染色源但描边有色：内光沿用描边色
      const kg =
        ist.gl[j] < 0.01 && targetGl > 0
          ? 1
          : movingTool
            ? COLOR_K
            : scaleK(COLOR_K, scale);
      ist.ir[j] += (st.r[ringIdx] - ist.ir[j]) * kg;
      ist.ig[j] += (st.g[ringIdx] - ist.ig[j]) * kg;
      ist.ib[j] += (st.b[ringIdx] - ist.ib[j]) * kg;
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
    ist.gl[i] += glDelta * fadeK;
    if (Math.abs(glDelta) > 0.004) ST.fadePending = true;
    if (Math.abs(glDelta) > maxDelta) maxDelta = Math.abs(glDelta);
    // 暗部只贴在内光带与外光交界处：强度直接跟内光能量走，
    // 不再沿圆周在亮点两侧做 bump（那会围着内光包一圈）。
    rawSh[i] = smoothstep(0.08, 0.5, shadeGl[i]);
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
    ist.sh[i] += shDelta * fadeK;
    if (Math.abs(shDelta) > 0.004) ST.fadePending = true;
    if (Math.abs(shDelta) > maxDelta) maxDelta = Math.abs(shDelta);
  }
  // 暗部不是压暗，而是在该处停止绘制内光（lit=0），
  // 让底层默认高光样式的暗部自己透出来；shade 只是控制这个“留空”的平滑形状。
  // 暗部改为独立乘式层叠暗，内光不再被 shade 停光
  const litAt = (i: number): number => ist.gl[i];
  const tintAt = (i: number): Rgb =>
    litAt(i) > 0.02
      ? { r: ist.ir[i], g: ist.ig[i], b: ist.ib[i] }
      : { r: 255, g: 255, b: 255 };

  // 外圈染色高光（根级取色每帧缓存一次，不再逐面板读根 computed style）
  const baseRgb = rootColorCached("ringBase", ringBaseRgb);
  if (maxDelta > 0.004) ST.fading.add(el);
  else ST.fading.delete(el);
  return {
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
    baseRgb,
  };
}

/** canvas2d 栅格阶段（原 drawPanel 栅格段逐字搬移；变量从采样产物解构）。 */
export function rasterPanel2d(
  s: PanelSample,
  ctx2: CanvasRenderingContext2D,
  shadeCtx2: CanvasRenderingContext2D,
): void {
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
    baseRgb,
  } = s;
  if (isDark()) {
    strokeUniformBand(ctx2, pts, 0.9, 0, baseRgb, toolFade);
  } else {
    strokeUniformBand(shadeCtx2, pts, 0.9, 0, baseRgb, toolFade);
  }
  strokeHighQualityBand(
    ctx2,
    pts,
    1,
    (i) => st.a[i] * LINE_ALPHA,
    (i) => ({ r: st.r[i], g: st.g[i], b: st.b[i] }),
    toolFade,
  );
  // 宽层只在高亮处显现：亮粗暗细由 alpha 控制，避免逐点线宽造成小点
  strokeHighQualityBand(
    ctx2,
    pts,
    2.6,
    (i) => Math.pow(st.a[i] / 2.4, 2) * 0.26,
    (i) => ({ r: st.r[i], g: st.g[i], b: st.b[i] }),
    toolFade,
  );
  // 完整内光 blur：工具栏滚动期间由离屏 buffer 复用承担成本。
  // __vxNoBlur：运行时二分开关（perf 归因）——关掉全部模糊带绘制
  if (
    glowAlpha > 0.002 &&
    !(globalThis as { __vxNoBlur?: boolean }).__vxNoBlur
  ) {
    // 染色向内侧轻微 blur：裁剪到卡片内部，避免向外发糊
    ctx2.save();
    roundedRectPath(ctx2, rect.left, rect.top, rect.width, rect.height, corner);
    ctx2.clip();
    strokeGlowBand(
      ctx2,
      pts,
      3,
      2,
      (i) => st.a[i] * LINE_ALPHA * 0.3 * glowAlpha,
      (i) => ({ r: st.r[i], g: st.g[i], b: st.b[i] }),
      toolFade,
    );
    ctx2.restore();
    // 细光核与近光晕：宽度随亮度微调
    const coreW = (i: number): number =>
      Math.max(0.6, MENISCUS_WIDTH * (0.3 + 0.85 * litAt(i)));
    strokeGlowBand(
      ctx2,
      mainPts,
      coreW,
      MENISCUS_BLUR,
      (i) => litAt(i) * MENISCUS_ALPHA * glowAlpha,
      (i) => tintAt(i),
      toolFade,
    );
    // 近光晕：能量越高越宽，亮度降低时半径同步收窄
    strokeGlowBand(
      ctx2,
      mainPts,
      (i) => Math.max(0.5, MENISCUS_HALO_WIDTH * Math.pow(litAt(i), 1.25)),
      MENISCUS_HALO_BLUR,
      (i) => Math.pow(litAt(i), 2) * MENISCUS_HALO_ALPHA * glowAlpha,
      (i) => tintAt(i),
      toolFade,
    );
  }

  // 暗部：独立乘式层。单条软带贴边 + 轻模糊，避免多条 1px 同心环
  // 在抗锯齿下出现脏边的颗粒感。
  const darkRgb = rootColorCached("edgeShade", edgeShadeRgb);
  const darkAlpha = edgeShadeAlpha() * glowAlpha;
  const darkPts = insetRing(rect, corner, 1.4);
  if (darkAlpha > 0.002 && darkPts.length >= 2) {
    const mapDark = mapRingToReference(darkPts, mainPts);
    shadeCtx2.save();
    roundedRectPath(
      shadeCtx2,
      rect.left,
      rect.top,
      rect.width,
      rect.height,
      corner,
    );
    shadeCtx2.clip();
    strokeGlowBand(
      shadeCtx2,
      darkPts,
      1.8,
      1.6,
      (i) => Math.pow(ist.sh[mapDark[i] ?? 0], 1.3) * darkAlpha,
      () => darkRgb,
      toolFade,
    );
    shadeCtx2.restore();
  }
}

/** canvas2d 栅格后端入口（对外行为与拆分前的 drawPanel 一致）：采样 → 栅格。 */
export function drawPanel(
  el: HTMLElement,
  ctx2: CanvasRenderingContext2D,
  shadeCtx2: CanvasRenderingContext2D,
  cards: LightSet,
  frameScale = 1,
): void {
  const s = samplePanel(el, cards, frameScale);
  if (!s) return;
  rasterPanel2d(s, ctx2, shadeCtx2);
}
