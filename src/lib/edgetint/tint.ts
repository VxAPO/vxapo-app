// 边缘染色的采样与绘制：颜色/亮度采样、环带与描边、面板离屏绘制（决策 5 阶段 A 第四批，
// 从 hooks/useEdgeTintLayer.ts 原样搬出，行为零变化；状态经 state.ts 的 ST 共享）。

import { COLOR_K, FADE_K, INNER_SAMPLE_R, LINE_ALPHA, MAX_SOURCE_R, MENISCUS_ALPHA, MENISCUS_BLUR, MENISCUS_HALO_ALPHA, MENISCUS_HALO_BLUR, MENISCUS_HALO_WIDTH, MENISCUS_INSET, MENISCUS_WIDTH, SAMPLE_R, SHADE_OUT_SMOOTH_R, SHADE_SMOOTH_R, edgeShadeAlpha, edgeShadeRgb, insetRing, isDark, mapRingToReference, panelBaseLum, panelRectsForTool, parseColor, ringBaseRgb, ringPoints, sampleColor, scaleK, smoothstep, strokeChunkBand, strokeUniformBand } from "./geometry";
import type { ColorSource, Rgb, RingPoint } from "./geometry";
import { isToolbar, roundedRectPath, sampleColorGrid, sampleLumGrid } from "./primitives";
import type { InnerState, LightSet } from "./primitives";
import { ST } from "./state";
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

export function cardColor(el: HTMLElement): Rgb | null {
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

export function strokeGlowBand(
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

export function drawPanel(
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
