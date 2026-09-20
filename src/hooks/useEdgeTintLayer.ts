import { useEffect, type RefObject } from "react";
import { edgeShadeAlpha, edgeShadeRgb, isDark, panelBaseLum, parseColor, rgbLuminance, ringBaseRgb, scaleK, smoothstep, surfaceLumOf } from "../lib/edgetint/geometry";
import type { ColorSource, LumSource, Rgb } from "../lib/edgetint/geometry";
import { COLOR_K, FADE_FRAME_MS, FADE_K, INNER_SAMPLE_R, LINE_ALPHA, MAX_SOURCE_R, MENISCUS_ALPHA, MENISCUS_BLUR, MENISCUS_HALO_ALPHA, MENISCUS_HALO_BLUR, MENISCUS_HALO_WIDTH, MENISCUS_INSET, MENISCUS_WIDTH, PANEL_REUSE_MAX, PANEL_REUSE_MS, SAMPLE_R, SHADE_OUT_SMOOTH_R, SHADE_SMOOTH_R, Z_BASE, Z_SHADE, Z_TOOL, Z_TOOL_SHADE, buildGrid, insetRing, mapRingToReference, panelRectsForTool, ringPoints, sampleColor, strokeChunkBand, strokeUniformBand } from "../lib/edgetint/geometry";
import type { RingPoint } from "../lib/edgetint/geometry";
import { clearDirtyUnion, clipToolbar, dirtyForEls, isToolbar, roundedRectPath, sampleColorGrid, sampleLumGrid, visibleRectOf } from "../lib/edgetint/primitives";
import type { CardNode, InnerState, LightSet } from "../lib/edgetint/primitives";
import { ST } from "../lib/edgetint/state";
import type { PanelBuffer } from "../lib/edgetint/state";

function refreshCardNodes(): CardNode[] {
  // 两套视图常驻 DOM：只把当前视图的卡片当作光源，隐藏视图不参与采样
  const scope =
    document.querySelector<HTMLElement>(".view-stage.is-active") ?? document;
  ST.cardNodes = [...scope.querySelectorAll<HTMLElement>("[data-dnd-id]")].map(
    (el) => ({
      el,
      accents: [
        ...el.querySelectorAll<HTMLElement>(
          ".sem-chip, .enable-dot.on, .effect-dot.on",
        ),
      ],
    }),
  );
  return ST.cardNodes;
}

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
  ST.curvePointCache.set(path, { key, pts });
  return pts;
}


function makeLayer(
  z: number,
  blend: "screen" | "multiply" = "screen",
): {
  c: HTMLCanvasElement;
  k: CanvasRenderingContext2D;
} | null {
  const c = document.createElement("canvas");
  c.style.cssText =
    `position:fixed;left:0;top:0;pointer-events:none;z-index:${z};mix-blend-mode:${blend};`;
  if (blend === "multiply") c.classList.add("vx-edge-shade");
  const k = c.getContext("2d");
  if (!k) {
    c.remove();
    return null;
  }
  (ST.host ?? document.body).appendChild(c);
  return { c, k };
}

function ensureCanvas(h: HTMLElement | null = null): void {
  if (h) ST.host = h;
  if (!ST.host) ST.host = document.body;
  const mount = ST.host.isConnected ? ST.host : document.body;
  if (ST.canvas && ST.canvas.parentElement !== mount) mount.appendChild(ST.canvas);
  if (ST.shadeCanvas && ST.shadeCanvas.parentElement !== mount) {
    mount.appendChild(ST.shadeCanvas);
  }
  if (ST.toolCanvas && ST.toolCanvas.parentElement !== mount) {
    mount.appendChild(ST.toolCanvas);
  }
  if (ST.toolShadeCanvas && ST.toolShadeCanvas.parentElement !== mount) {
    mount.appendChild(ST.toolShadeCanvas);
  }
  if (
    ST.canvas &&
    ST.ctx &&
    ST.shadeCanvas &&
    ST.shadeCtx &&
    ST.toolCanvas &&
    ST.toolCtx &&
    ST.toolShadeCanvas &&
    ST.toolShadeCtx
  ) {
    return;
  }
  const base = ST.canvas && ST.ctx ? null : makeLayer(Z_BASE);
  const shade = ST.shadeCanvas && ST.shadeCtx ? null : makeLayer(Z_SHADE, "multiply");
  const tool = ST.toolCanvas && ST.toolCtx ? null : makeLayer(Z_TOOL);
  const toolShade =
    ST.toolShadeCanvas && ST.toolShadeCtx
      ? null
      : makeLayer(Z_TOOL_SHADE, "multiply");
  if (base) {
    ST.canvas = base.c;
    ST.ctx = base.k;
  }
  if (shade) {
    ST.shadeCanvas = shade.c;
    ST.shadeCtx = shade.k;
  }
  if (tool) {
    ST.toolCanvas = tool.c;
    ST.toolCtx = tool.k;
  }
  if (toolShade) {
    ST.toolShadeCanvas = toolShade.c;
    ST.toolShadeCtx = toolShade.k;
  }
}










function cardColor(el: HTMLElement): Rgb | null {
  const hit = ST.colorCache.get(el);
  if (hit && performance.now() - hit.at < 500) return hit.color;
  const cs = getComputedStyle(el);
  const darkKey = "--card-accent-dark";
  const lightKey = "--card-accent";
  const accent =
    cs.getPropertyValue(isDark() ? darkKey : lightKey).trim() ||
    cs.getPropertyValue(lightKey).trim();
  const fallbackBrand =
    parseColor(cs.getPropertyValue("--brand").trim()) ||
    parseColor(
      getComputedStyle(document.documentElement)
        .getPropertyValue("--brand")
        .trim(),
    );
  const color =
    parseColor(accent) ||
    (el.dataset.dndGroup === "effects" ||
    !el.classList.contains("sem-group")
      ? fallbackBrand
      : null);
  ST.colorCache.set(el, { at: performance.now(), color });
  return color;
}

function stateForRing(el: HTMLElement, n: number) {
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

function stateForInner(el: HTMLElement, n: number): InnerState {
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







function ensureSoftCanvas(w: number, h: number): void {
  const needW = Math.max(1, Math.ceil(w));
  const needH = Math.max(1, Math.ceil(h));
  if (!ST.softCanvas) {
    ST.softCanvas = document.createElement("canvas");
    ST.softCtx = ST.softCanvas.getContext("2d");
    if (!ST.softCtx) {
      ST.softCanvas.remove();
      ST.softCanvas = null;
      ST.softCtx = null;
      return;
    }
  }
  if (ST.softCanvas.width < needW || ST.softCanvas.height < needH) {
    ST.softCanvas.width = Math.max(ST.softCanvas.width, needW);
    ST.softCanvas.height = Math.max(ST.softCanvas.height, needH);
  }
}

function ensureSsCanvas(w: number, h: number): void {
  if (!ST.ssCanvas) {
    ST.ssCanvas = document.createElement("canvas");
    ST.ssCtx = ST.ssCanvas.getContext("2d");
    if (!ST.ssCtx) {
      ST.ssCanvas.remove();
      ST.ssCanvas = null;
      ST.ssCtx = null;
      return;
    }
  }
  if (ST.ssCanvas.width < w || ST.ssCanvas.height < h) {
    ST.ssCanvas.width = Math.max(ST.ssCanvas.width, Math.ceil(w));
    ST.ssCanvas.height = Math.max(ST.ssCanvas.height, Math.ceil(h));
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
  const SCALE = 4;
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
  bandCtx.imageSmoothingQuality = "high";
  bandCtx.drawImage(
    ST.ssCanvas,
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

function drawPanel(
  el: HTMLElement,
  ctx2: CanvasRenderingContext2D,
  shadeCtx2: CanvasRenderingContext2D,
  cards: LightSet,
  frameScale = 1,
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
  const movingTool = tool && ST.scrollingNow;
  // 按时间推进：frameScale=1（正常 33ms 补帧）时与原常数逐字等价；
  // 复用跳帧时按经过的步数放大，保证褪色总时长不变（只是步数更少、每步更大）。
  const scale = Math.max(1, frameScale);
  const fadeK = movingTool ? 1 : scaleK(FADE_K, scale);
  const colorK = movingTool ? 1 : scaleK(COLOR_K, scale);
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
    // 叠卡时开关/圆点虽然可见，但隔着玻璃已衰减：强度倍率降低
    const cardSample =
      rawCardSample && overPanel
        ? { ...rawCardSample, s: rawCardSample.s * 0.5 }
        : rawCardSample;
    const sample =
      overPanel && curveSample && (!cardSample || curveSample.s >= cardSample.s)
        ? curveSample
        : cardSample;
    const targetA = sample ? sample.s : 0;
    const aDelta = targetA - st.a[i];
    st.a[i] += aDelta * fadeK;
    if (Math.abs(aDelta) > 0.004) ST.fadePending = true;
    const c = sample ? sample.c : null;
    if (c) {
      const fresh = st.a[i] < 0.01 && targetA > 0;
      const k = fresh ? 1 : colorK;
      st.r[i] += (c.r - st.r[i]) * k;
      st.g[i] += (c.g - st.g[i]) * k;
      st.b[i] += (c.b - st.b[i]) * k;
    }
  }
  // 内光直接在内圈路径上逐点采样，不再从外圈做序号映射，
  // 圆角处的采样点与绘制点一一对应。
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
    const innerFade = toolOverPanel ? 0.75 : 1;
    const colorEnergy = innerTint
      ? Math.min(1, (innerTint.s * innerFade) / 1.1)
      : 0;
    const lumEnergy =
      Math.min(1, contrast * 1.6) *
      Math.pow(prox, 0.8) *
      innerFade;
    const targetGl = Math.min(1, colorEnergy + lumEnergy * 0.55);
    rawGl[j] = targetGl;
    if (innerTint) {
      const kg =
        ist.gl[j] < 0.01 && targetGl > 0
          ? 1
          : movingTool
            ? COLOR_K
            : scaleK(COLOR_K, scale);
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
    ist.gl[i] += glDelta * fadeK;
    if (Math.abs(glDelta) > 0.004) ST.fadePending = true;
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
  }
  // 暗部不是压暗，而是在该处停止绘制内光（lit=0），
  // 让底层默认高光样式的暗部自己透出来；shade 只是控制这个“留空”的平滑形状。
  // 暗部改为独立乘式层叠暗，内光不再被 shade 停光
  const litAt = (i: number): number => ist.gl[i];
  const tintAt = (i: number): Rgb =>
    litAt(i) > 0.02
      ? { r: ist.ir[i], g: ist.ig[i], b: ist.ib[i] }
      : { r: 255, g: 255, b: 255 };

  // 外圈染色高光
  const baseRgb = ringBaseRgb();
  if (isDark()) {
    strokeUniformBand(
      ctx2,
      pts,
      0.9,
      0,
      baseRgb,
      toolFade,
    );
  } else {
    strokeUniformBand(
      shadeCtx2,
      pts,
      0.9,
      0,
      baseRgb,
      toolFade,
    );
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
  if (glowAlpha > 0.002) {
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
  const darkRgb = edgeShadeRgb();
  const darkAlpha = edgeShadeAlpha() * glowAlpha;
  const darkPts = insetRing(rect, corner, 1.4);
  if (darkAlpha > 0.002 && darkPts.length >= 2) {
    const mapDark = mapRingToReference(darkPts, mainPts);
    shadeCtx2.save();
    roundedRectPath(shadeCtx2, rect.left, rect.top, rect.width, rect.height, corner);
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

function collectCards(): LightSet {
  const colors: ColorSource[] = [];
  const lums: LumSource[] = [];
  const curve = curvePointSources();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const nodes = ST.cardNodes ?? refreshCardNodes();
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
  return {
    colors,
    lums,
    curve,
    colorGrid: buildGrid(colors),
    lumGrid: buildGrid(lums),
  };
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
  // 工具栏被滚动容器裁掉/淡出后不再生成 buffer，让上一帧脏区被清掉。
  if (isToolbar(el)) {
    const opacity = parseFloat(getComputedStyle(el).opacity);
    if (!Number.isFinite(opacity) || opacity <= 0.02) return null;
    if (
      rect.right < -PAD ||
      rect.left > window.innerWidth + PAD ||
      rect.bottom < -PAD ||
      rect.top > window.innerHeight + PAD
    ) {
      return null;
    }
  }
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  let buf = ST.panelBuffers.get(el);
  if (
    !buf ||
    buf.w !== w ||
    buf.h !== h ||
    buf.dpr !== dpr ||
    buf.c.width !== Math.ceil(w * dpr) ||
    buf.c.height !== Math.ceil(h * dpr) ||
    !buf.sc ||
    !buf.sk
  ) {
    const c = document.createElement("canvas");
    const k = c.getContext("2d");
    const sc = document.createElement("canvas");
    const sk = sc.getContext("2d");
    if (!k || !sk) return null;
    buf = { c, k, sc, sk, at: 0, reused: 0, x, y, w, h, dpr };
    ST.panelBuffers.set(el, buf);
  }
  /**
   * buf.x/y 是**渲染时**的视口位置：缓冲里的像素就是按它画的（drawPanel 用
   * setTransform(dpr,0,0,dpr,-x*dpr,-y*dpr)），blit 也按它贴回画布。
   *
   * 复用窗口（下方 blit 分支）会直接返回上一帧像素，因此位置必须与像素一致：
   * 若把本次 rect 的位置写给旧像素，面板（含环带/染色）会整体错位若干像素；
   * 滚动收敛后重绘停止，错位会留在画布上直到下一次重绘覆盖（现象：某几个滚动
   * 位置出现一小块发白的错位带）。
   */
  if (
    buf.c.width !== Math.ceil(w * dpr) ||
    buf.c.height !== Math.ceil(h * dpr)
  ) {
    buf.c.width = Math.ceil(w * dpr);
    buf.c.height = Math.ceil(h * dpr);
  }
  if (
    buf.sc.width !== Math.ceil(w * dpr) ||
    buf.sc.height !== Math.ceil(h * dpr)
  ) {
    buf.sc.width = Math.ceil(w * dpr);
    buf.sc.height = Math.ceil(h * dpr);
  }
  // 复用上一帧离屏 buffer：面板绘制（4× 超采样描边 + 整张模糊）是重绘的固定大头，
  // 而画布原点与 blit 偏移都取自本次 dirtyForEls()，所以环带位置永远精确，
  // 复用的只是「采样到的配色」——它最多滞后 PANEL_REUSE_MS，且至少每 3 帧重算一次。
  const now = performance.now();
  // 工具栏滚动期间用更长的 140ms 复用窗口（滚动时几何相对内容不变）
  if (
    isToolbar(el) &&
    ST.scrollingNow &&
    buf.at > 0 &&
    now - buf.at < 140 &&
    Math.abs(x - buf.x) < 0.5 &&
    Math.abs(y - buf.y) < 0.5
  ) {
    buf.reused += 1;
    return buf;
  }
  if (
    buf.at > 0 &&
    buf.reused < PANEL_REUSE_MAX &&
    now - buf.at < PANEL_REUSE_MS &&
    Math.abs(x - buf.x) < 0.5 &&
    Math.abs(y - buf.y) < 0.5
  ) {
    buf.reused += 1;
    return buf;
  }
  // 真正要重画了：把渲染位置对齐到本次 rect（blit 与像素始终同源）
  buf.x = x;
  buf.y = y;
  // 距上次真实渲染过了多少个基准步：用于把褪色插值按时间推进（复用不改褪色时长）
  const frameScale = buf.at > 0 ? (now - buf.at) / FADE_FRAME_MS : 1;
  buf.reused = 0;
  buf.at = now;
  buf.k.setTransform(1, 0, 0, 1, 0, 0);
  buf.k.clearRect(0, 0, buf.c.width, buf.c.height);
  buf.k.setTransform(dpr, 0, 0, dpr, -x * dpr, -y * dpr);
  buf.sk.setTransform(1, 0, 0, 1, 0, 0);
  buf.sk.clearRect(0, 0, buf.sc.width, buf.sc.height);
  buf.sk.setTransform(dpr, 0, 0, dpr, -x * dpr, -y * dpr);
  drawPanel(el, buf.k, buf.sk, cards, frameScale);
  return buf;
}


function paintLayerPair(
  c: HTMLCanvasElement | null,
  k: CanvasRenderingContext2D | null,
  sc: HTMLCanvasElement | null,
  sk: CanvasRenderingContext2D | null,
  els: HTMLElement[],
  cards: LightSet,
  kind: "base" | "tool",
): void {
  if (!c || !k || !sc || !sk) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  // 画布只覆盖本次真正会绘制的范围（目标矩形 ± PAD，已含外扩光晕）。
  // 绘制坐标仍是视口坐标，像素与整窗画布完全一致；但 mix-blend-mode 的混合层
  // 面积从整窗缩到面板范围，动画期间的重合成开销大幅下降（实测帧间隔 20-70ms → 10-20ms）。
  const next = dirtyForEls(els);
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const ox = next ? Math.max(0, Math.floor(next.x)) : 0;
  const oy = next ? Math.max(0, Math.floor(next.y)) : 0;
  const ow = next
    ? Math.max(1, Math.min(vw, Math.ceil(next.x + next.w)) - ox)
    : 1;
  const oh = next
    ? Math.max(1, Math.min(vh, Math.ceil(next.y + next.h)) - oy)
    : 1;
  const bw = Math.max(1, Math.round(ow * dpr));
  const bh = Math.max(1, Math.round(oh * dpr));
  const prevOrigin = kind === "base" ? ST.prevBaseOrigin : ST.prevToolOrigin;
  const geomChanged =
    c.width !== bw ||
    c.height !== bh ||
    !prevOrigin ||
    prevOrigin.x !== ox ||
    prevOrigin.y !== oy;
  c.style.left = `${ox}px`;
  c.style.top = `${oy}px`;
  c.style.width = `${ow}px`;
  c.style.height = `${oh}px`;
  sc.style.left = `${ox}px`;
  sc.style.top = `${oy}px`;
  sc.style.width = `${ow}px`;
  sc.style.height = `${oh}px`;
  if (geomChanged) {
    // 重新分配后备存储即等于整块清空，原点变化时不会有残留旧像素
    c.width = bw;
    c.height = bh;
    sc.width = bw;
    sc.height = bh;
  }
  k.setTransform(dpr, 0, 0, dpr, -ox * dpr, -oy * dpr);
  sk.setTransform(dpr, 0, 0, dpr, -ox * dpr, -oy * dpr);
  const prev = kind === "base" ? ST.prevBaseDirty : ST.prevToolDirty;
  if (!geomChanged) {
    // clearRect 与 drawImage 共用同一 CTM（已含 -原点 平移），这里必须传视口坐标：
    // 再减一次原点会把清屏区域整体挪走，旧像素清不掉、画面层层叠加。
    clearDirtyUnion(k, prev, next);
    clearDirtyUnion(sk, prev, next);
  }
  if (kind === "base") {
    ST.prevBaseDirty = next;
    ST.prevBaseOrigin = { x: ox, y: oy };
  } else {
    ST.prevToolDirty = next;
    ST.prevToolOrigin = { x: ox, y: oy };
  }
  if (!els.length) return;
  els.forEach((el) => {
    const buf = renderToPanelBuffer(el, cards);
    if (buf) {
      const r = el.getBoundingClientRect();
      const clipped = visibleRectOf(el, 32);
      const pl = Math.max(0, r.left - 32);
      const pt = Math.max(0, r.top - 32);
      const prr = Math.min(window.innerWidth, r.right + 32);
      const pb = Math.min(window.innerHeight, r.bottom + 32);
      const vis =
        clipped.w >= 0.5 && clipped.h >= 0.5
          ? clipped
          : {
              left: pl,
              top: pt,
              w: Math.max(0, prr - pl),
              h: Math.max(0, pb - pt),
            };
      if (toolbar) {
        const body = document.querySelector<HTMLElement>(".device-body");
        if (body) {
          const br = body.getBoundingClientRect();
          const l = Math.max(vis.left, br.left);
          const t = Math.max(vis.top, br.top);
          const rr = Math.min(vis.left + vis.w, br.right);
          const bb = Math.min(vis.top + vis.h, br.bottom);
          vis.left = l;
          vis.top = t;
          vis.w = Math.max(0, rr - l);
          vis.h = Math.max(0, bb - t);
        }
        if (vis.w < 0.5 || vis.h < 0.5) return;
      }
      if (toolbar) {
        k.save();
        clipToolbar(k, vis);
      }
      k.drawImage(
        buf.c,
        buf.x,
        buf.y,
        buf.w,
        buf.h,
      );
      if (toolbar) k.restore();
      if (toolbar) {
        sk.save();
        clipToolbar(sk, vis);
      }
      sk.drawImage(
        buf.sc,
        buf.x,
        buf.y,
        buf.w,
        buf.h,
      );
      if (toolbar) sk.restore();
    }
  });
}

function paint(): void {
  ST.raf = 0;
  try {
    if (!ST.running || !ST.targets.size) return;
    ST.fadePending = false;
    const cards = collectCards();
    const els = [...ST.targets];
    if (ST.paintMode !== "tool") {
      paintLayerPair(
        ST.canvas,
        ST.ctx,
        ST.shadeCanvas,
        ST.shadeCtx,
        els.filter((el) => !isToolbar(el)),
        cards,
        "base",
      );
    }
    paintLayerPair(
      ST.toolCanvas,
      ST.toolCtx,
      ST.toolShadeCanvas,
      ST.toolShadeCtx,
      els.filter(isToolbar),
      cards,
      "tool",
    );
    if (ST.paintMode === "full" && ST.fadePending) {
      window.setTimeout(() => schedule("full"), 33);
    } else if (ST.paintMode === "full" && ST.viewAnimUntil > performance.now()) {
      window.setTimeout(() => schedule("full"), 16);
    }
    if (ST.paintMode === "full" && ST.viewAnimUntil <= performance.now()) {
      ST.viewAnimUntil = 0;
    }
  } catch (err) {
    console.error("[edgeTint] paint failed", err);
  }
}

function schedule(mode: "tool" | "full" = "full"): void {
  if (!ST.running) return;
  ST.paintMode = mode;
  if (ST.raf) return;
  ST.raf = requestAnimationFrame(paint);
}

function onScroll(): void {
  // 绘制本身已足够快：滚动期间直接全量刷新，
  // 避免底卡/曲线染色要等停顿后才更新。
  window.clearTimeout(ST.scrollIdleTimer);
  document.documentElement.classList.add("is-scrolling");
  ST.scrollingNow = true;
  ST.scrollIdleTimer = window.setTimeout(() => {
    ST.scrollingNow = false;
    document.documentElement.classList.remove("is-scrolling");
    schedule("full");
  }, 140);
  schedule("full");
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
  if (ST.running) return;
  ensureCanvas();
  ST.running = true;
  window.addEventListener("scroll", onScroll, {
    capture: true,
    passive: true,
  });
  window.addEventListener("resize", onResize);
  window.addEventListener("focus", onFocus);
  document.addEventListener("visibilitychange", onVisibilityChange);
  ST.themeObserver = new MutationObserver(() => {
    ST.colorCache = new WeakMap();
    // 主题切换会整体换色：清掉面板缓冲，避免复用窗口把旧配色留在画面上
    ST.panelBuffers = new WeakMap();
    if (document.documentElement.classList.contains("theme-transition")) {
      // 主题过渡期间不抢帧；等 DOM 动画结束后做一次最终刷新。
      window.clearTimeout(ST.themePaintTimer);
      ST.themePaintTimer = window.setTimeout(() => schedule("full"), 460);
    } else {
      schedule("full");
    }
  });
  ST.themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  ST.layoutObserver = new MutationObserver((records) => {
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
      ) ||
      // 视图常驻后切换视图只改 .view-stage 的类名：光源集合换了，必须重取卡片
      records.some(
        (m) =>
          m.type === "attributes" &&
          m.attributeName === "class" &&
          m.target instanceof HTMLElement &&
          m.target.classList.contains("view-stage"),
      );
    const viewStyleChanged = records.some(
      (m) =>
        m.type === "attributes" &&
        m.attributeName === "style" &&
        m.target instanceof HTMLElement &&
        m.target.closest(".view-stage"),
    );
    const dragStyleChanged = records.some(
      (m) =>
        m.type === "attributes" &&
        m.attributeName === "style" &&
        m.target instanceof HTMLElement &&
        m.target.hasAttribute("data-dnd-id"),
    );
    if (structureChanged) {
      refreshCardNodes();
      // 卡片增减会改变光源集合，必须重绘一次（原逻辑依赖 300ms 轮询兜底）
      schedule("full");
    }
    if (toolbarMoved) {
      // 工具栏位移动画每帧改 style；MutationObserver 在该帧渲染前触发，
      // 同步重画可以对齐当前帧位置，避免 Canvas 永远慢半拍。
      if (ST.raf) cancelAnimationFrame(ST.raf);
      ST.raf = 0;
      ST.paintMode = "tool";
      paint();
      return;
    }
    if (viewStyleChanged) {
      if (!ST.viewAnimUntil) {
        ST.viewAnimUntil = performance.now() + 420;
        schedule("full");
      }
      return;
    }
    if (dragStyleChanged) {
      return;
    }
    if (selectionChanged) {
      // 框选拖动会每帧改 is-selected；不立即全量重绘，
      // 停顿后刷新一次，让选中描边权重收敛。
      window.clearTimeout(ST.selectionTimer);
      ST.selectionTimer = window.setTimeout(() => schedule("full"), 160);
      return;
    }
    if (!records.length) return;
  });
  ST.layoutObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "style", "data-dnd-id", "data-dnd-group"],
  });
  schedule();
  // HMR/刷新后 DOM 可能晚于模块初始化：分几拍再全量采样，
  // 避免“要滚动一下才开始染色”。
  [80, 220, 500].forEach((ms) =>
    window.setTimeout(() => schedule("full"), ms),
  );
}

function stop(): void {
  ST.running = false;
  if (ST.raf) cancelAnimationFrame(ST.raf);
  ST.raf = 0;
  window.removeEventListener("scroll", onScroll, {
    capture: true,
  } as EventListenerOptions);
  window.removeEventListener("resize", onResize);
  window.removeEventListener("focus", onFocus);
  document.removeEventListener("visibilitychange", onVisibilityChange);
  window.clearTimeout(ST.scrollIdleTimer);
  ST.scrollIdleTimer = 0;
  document.documentElement.classList.remove("is-scrolling");
  window.clearTimeout(ST.selectionTimer);
  ST.selectionTimer = 0;
  window.clearTimeout(ST.themePaintTimer);
  ST.themePaintTimer = 0;
  ST.viewAnimUntil = 0;
  ST.themeObserver?.disconnect();
  ST.themeObserver = null;
  ST.layoutObserver?.disconnect();
  ST.layoutObserver = null;
  ST.colorCache = new WeakMap();
  ST.panelBuffers = new WeakMap();
  ST.canvas?.remove();
  ST.canvas = null;
  ST.ctx = null;
  ST.shadeCanvas?.remove();
  ST.shadeCanvas = null;
  ST.shadeCtx = null;
  ST.toolCanvas?.remove();
  ST.toolCanvas = null;
  ST.toolCtx = null;
  ST.toolShadeCanvas?.remove();
  ST.toolShadeCanvas = null;
  ST.toolShadeCtx = null;
  ST.softCanvas?.remove();
  ST.softCanvas = null;
  ST.softCtx = null;
  ST.ssCanvas?.remove();
  ST.ssCanvas = null;
  ST.ssCtx = null;
}

/** 注册绘制目标；返回是否真的新增了目标（用于决定是否需要重绘）。 */
function registerTarget(el: HTMLElement): boolean {
  if (ST.targets.has(el)) return false;
  const nextHost =
    (el.closest(".device-body") as HTMLElement | null) ?? document.body;
  if (!ST.targets.size) {
    ST.host = nextHost;
    start();
  } else if (ST.host !== nextHost) {
    // 语言/设备切换会用新的 key 重建 .device-body：旧宿主已脱离文档时，
    // 必须把 Canvas 挪到新宿主，否则画面会画在不可见节点上。
    ensureCanvas(nextHost);
  }
  ST.targets.add(el);
  const ro = new ResizeObserver(() => schedule("full"));
  ro.observe(el);
  ST.targetRos.set(el, ro);
  return true;
}

function removeTarget(el: HTMLElement): void {
  ST.targetRos.get(el)?.disconnect();
  ST.targetRos.delete(el);
  ST.targets.delete(el);
  const buf = ST.panelBuffers.get(el);
  if (buf) {
    buf.c.remove();
    buf.sc.remove();
    ST.panelBuffers.delete(el);
  }
  if (!ST.targets.size) stop();
}

function syncTargets(): void {
  const nodes = document.querySelectorAll<HTMLElement>(
    ".fx-curve, .fx-dev, .fx-toolbar",
  );
  const found = new Set<HTMLElement>();
  let changed = false;
  nodes.forEach((el) => {
    found.add(el);
    if (registerTarget(el)) changed = true;
  });
  [...ST.targets].forEach((el) => {
    if (!found.has(el) || !el.isConnected) {
      removeTarget(el);
      changed = true;
    }
  });
  // 集合本身没变时不再无条件重绘：只有几何指纹（目标/卡片/强调块的位置尺寸）
  // 真的变化时才需要一次全量重绘，其余情况保持上一帧画面。
  const sig = targetScanSignature();
  if (changed || sig !== ST.scanSig) {
    ST.scanSig = sig;
    schedule("full");
  }
}

/** 目标集合与卡片几何指纹：仅用于判断「是否需要重绘」，不参与绘制。 */
function targetScanSignature(): string {
  const cards = ST.cardNodes ?? refreshCardNodes();
  const parts: string[] = [];
  const push = (r: DOMRect) => {
    parts.push(
      `${Math.round(r.left)},${Math.round(r.top)},${Math.round(r.width)},${Math.round(r.height)}`,
    );
  };
  for (const el of ST.targets) {
    if (el.isConnected) push(el.getBoundingClientRect());
  }
  for (const { el, accents } of cards) {
    if (!el.isConnected) continue;
    push(el.getBoundingClientRect());
    for (const a of accents) push(a.getBoundingClientRect());
  }
  return parts.join("|");
}

/** 模块级自动扫描：不依赖 React hook 生命周期，HMR 或晚挂载都能自愈。 */
function startAuto(): void {
  if (ST.autoStarted) return;
  ST.autoStarted = true;
  // 结构变化合并到一帧一次，避免 React 批量更新时反复全量扫描
  ST.autoMo = new MutationObserver(() => {
    if (ST.autoScanRaf) return;
    ST.autoScanRaf = requestAnimationFrame(() => {
      ST.autoScanRaf = 0;
      syncTargets();
    });
  });
  ST.autoMo.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
  if (document.body) {
    syncTargets();
  } else {
    document.addEventListener("DOMContentLoaded", syncTargets, { once: true });
  }
  // 兜底扫描：不依赖 MutationObserver 时序，保持与原先相同的 300ms 陈旧度上限；
  // 区别是扫描本身只做「集合 + 几何指纹」比较，没有变化就完全不重绘。
  ST.autoScanTimer = window.setInterval(syncTargets, 300);
}

function stopAuto(): void {
  ST.autoStarted = false;
  window.clearInterval(ST.autoScanTimer);
  ST.autoScanTimer = 0;
  if (ST.autoScanRaf) cancelAnimationFrame(ST.autoScanRaf);
  ST.autoScanRaf = 0;
  ST.scanSig = "";
  ST.autoMo?.disconnect();
  ST.autoMo = null;
  [...ST.targets].forEach(removeTarget);
}

/**
 * 边缘染色入口（决策 5 阶段 B：生命周期化）。
 *
 * 挂载时启动自动扫描、卸载时停掉：
 * - 删除原先的「import 即自启动」——模块被 import（含类型引用、测试）不再有副作用；
 * - 删除 `import.meta.hot.dispose` 自救——HMR 更新时 React Fast Refresh 会走 hook 的
 *   cleanup 卸载旧实例，自救逻辑已冗余。
 */
export function useEdgeTintLayer(_ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    // 三个挂载点（App / CurvePanel / 选择工具栏），且工具栏随选中态反复挂卸 ⇒
    // 用引用计数保证「首个挂载启动、最后一个卸载停止」，避免工具栏一隐藏就停掉整层染色。
    ST.autoRefCount += 1;
    if (ST.autoRefCount === 1) startAuto();
    return () => {
      ST.autoRefCount -= 1;
      if (ST.autoRefCount === 0) stopAuto();
    };
  }, []);
}
