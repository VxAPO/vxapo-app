// 边缘染色的渲染循环与生命周期：面板缓冲、脏区、paint/schedule、事件与 start/stop
//（决策 5 阶段 A 第四批，从 hooks/useEdgeTintLayer.ts 原样搬出，行为零变化；状态经 state.ts 的 ST 共享）。

import { FADE_FRAME_MS, PANEL_REUSE_MAX, PANEL_REUSE_MS } from "./geometry";
import { clearDirtyUnion, clipToolbar, dirtyForEls, isToolbar, visibleRectOf } from "./primitives";
import type { LightSet } from "./primitives";
import { ST } from "./state";
import type { PanelBuffer } from "./state";
import { ensureCanvas } from "./canvasPool";
import { drawPanel } from "./tint";
import { collectCards, refreshCardNodes } from "./targets";

/**
 * 目标当前的可见度（0..1）。染色画布是独立图层，不随 DOM 的淡入淡出变化，
 * 绘制时必须按它缩放透明度，否则会出现「页面/工具栏在淡出、染色纹丝不动，
 * 等 DOM 消失那一刻硬消失」。
 *
 * - 选中工具栏：读 `--glass-t`（0→1 的玻璃进度，见 drag.css；注册过的自定义属性
 *   在过渡期间取到的是插值中的值）；
 * - 页面内目标：读所在设备页的实时 opacity（进入是 CSS 过渡、退出是 framer-motion，
 *   两者都反映在 computed 值上）。
 */
export function targetVisibility(el: HTMLElement): number {
  const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 1);
  if (isToolbar(el)) {
    const cs = getComputedStyle(el);
    const t = Number.parseFloat(cs.getPropertyValue("--glass-t"));
    if (Number.isFinite(t)) return clamp01(t);
    // 兜底：没有 --glass-t（旧路径/未注册）时退回自身 opacity
    return clamp01(Number.parseFloat(cs.opacity));
  }
  const page = el.closest<HTMLElement>(".device-page");
  if (page) return clamp01(Number.parseFloat(getComputedStyle(page).opacity));
  return 1;
}

export function renderToPanelBuffer(
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
    if (targetVisibility(el) <= 0.02) return null;
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

export function paintLayerPair(
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
      // 目标正在淡入/淡出时按可见度缩放：画布像素要跟着 DOM 一起淡
      const fade = targetVisibility(el);
      if (fade <= 0.01) return;
      if (toolbar) {
        k.save();
        clipToolbar(k, vis);
      }
      k.globalAlpha = fade;
      k.drawImage(
        buf.c,
        buf.x,
        buf.y,
        buf.w,
        buf.h,
      );
      k.globalAlpha = 1;
      if (toolbar) k.restore();
      if (toolbar) {
        sk.save();
        clipToolbar(sk, vis);
      }
      sk.globalAlpha = fade;
      sk.drawImage(
        buf.sc,
        buf.x,
        buf.y,
        buf.w,
        buf.h,
      );
      sk.globalAlpha = 1;
      if (toolbar) sk.restore();
    }
  });
}

export function paint(): void {
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
    // 淡入淡出期间逐帧重绘：DOM 的透明度/玻璃进度在变，画布得跟着走。
    // 只有工具栏在淡就只刷工具栏画布；有页面内目标在淡就必须走 full（底图也在变）。
    const fadingBase = els.some(
      (el) => !isToolbar(el) && targetVisibility(el) < 0.999,
    );
    const fadingTool = els.some(
      (el) => isToolbar(el) && targetVisibility(el) < 0.999,
    );
    if (fadingBase || fadingTool) {
      window.setTimeout(() => schedule(fadingBase ? "full" : "tool"), 16);
    }
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

export function schedule(mode: "tool" | "full" = "full"): void {
  if (!ST.running) return;
  ST.paintMode = mode;
  if (ST.raf) return;
  ST.raf = requestAnimationFrame(paint);
}

export function onScroll(): void {
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

export function onResize(): void {
  schedule("full");
}

export function onFocus(): void {
  schedule("full");
}

export function onVisibilityChange(): void {
  schedule("full");
}

export function start(): void {
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

export function stop(): void {
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
