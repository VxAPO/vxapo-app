// 边缘染色的渲染循环与生命周期：面板缓冲、脏区、paint/schedule、事件与 start/stop
//（决策 5 阶段 A 第四批，从 hooks/useEdgeTintLayer.ts 原样搬出，行为零变化；状态经 state.ts 的 ST 共享）。

import {
  FADE_FRAME_MS,
  PANEL_PAD,
  PANEL_REUSE_MAX,
  PANEL_REUSE_MOTION_MS,
  PANEL_REUSE_MS,
} from "./geometry";
import {
  clearDirtyUnion,
  clipToolbar,
  dirtyForEls,
  isToolbar,
  visibleRectOf,
} from "./primitives";
import type { LightSet } from "./primitives";
import { ST } from "./state";
import type { PanelBuffer } from "./state";

// 面板重画相位（滚动期把 fading 面板分散到3个相位错峰重画）：
// 每元素一次随机相位，WeakMap 保证稳定且零 GC。
const elPhase = new WeakMap<HTMLElement, number>();
function elHash(el: HTMLElement): number {
  let h = elPhase.get(el);
  if (h === undefined) {
    h = (Math.random() * 3) | 0;
    elPhase.set(el, h);
  }
  return h;
}
import { csOf } from "./state";
import { canvas2dRaster } from "./raster";
import { glTintRaster } from "./gl-raster";
import { ensureCanvas } from "./canvasPool";
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
 *
 * 同一帧内多次调用（fade 检测、buffer 生成、blit 各一次）走 paintCache 只算一次：
 * 动画期间这些 getComputedStyle 与 framer-motion 的每帧 style 写入互相踩，读数本身
 * 也会强制样式重算。
 */
export function targetVisibility(el: HTMLElement): number {
  const hit = ST.paintCache.get(el);
  if (hit && hit.vis !== undefined) return hit.vis;
  const clamp01 = (n: number) =>
    Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 1;
  let v = 1;
  if (isToolbar(el)) {
    const cs = csOf(el);
    const t = Number.parseFloat(cs.getPropertyValue("--glass-t"));
    // 兜底：没有 --glass-t（旧路径/未注册）时退回自身 opacity
    v = Number.isFinite(t)
      ? clamp01(t)
      : clamp01(Number.parseFloat(cs.opacity));
  }
  // 再乘所在页面自身的淡入淡出：设备页切换时工具栏若还在（有选中），它得跟着页面一起淡
  const page = el.closest<HTMLElement>(".device-page");
  if (page) v *= clamp01(Number.parseFloat(csOf(page).opacity));
  const entry = ST.paintCache.get(el);
  if (entry) entry.vis = v;
  else ST.paintCache.set(el, { vis: v });
  return v;
}

export function renderToPanelBuffer(
  el: HTMLElement,
  cards: LightSet,
  kind: "base" | "tool",
): PanelBuffer | null {
  const rect = el.getBoundingClientRect();
  if (rect.width < 2 || rect.height < 2) return null;
  const PAD = PANEL_PAD;
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
    buf = { c, k, sc, sk, at: 0, reused: 0, x, y, w, h, dpr, gen: 0 };
    ST.panelBuffers.set(el, buf);
  }
  // 元素自上次渲染是否移动（工具栏随框选移动）：移动中的工具栏环带
  // 染色走 movingTool 快照直接跟随——否则停下后还要 ~300ms 慢收敛，
  // 「停住再变亮」残留在描边染色上的根因。
  const moved =
    buf.at > 0 && (Math.abs(buf.x - x) > 0.5 || Math.abs(buf.y - y) > 0.5);
  // 假移动（滚动平移）不触发重画：滚动时面板/工具栏与光源的相对几何
  // 不变，缓冲像素本来就是对的——位移由混合层画布的 translate 补偿
  //（guardTick 假移动守卫）。只有真实变化（fading/bufGen/选中/主题）
  // 才走重画。
  // 贴回位置每帧按当前 rect 计算：像素锚定元素，复用/重画两条路径都用它
  buf.x = x;
  buf.y = y;
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
  /**
   * 复用上一帧离屏 buffer：面板绘制（超采样描边 + 最多 4 次整张模糊）是
   * 重绘的固定大头。缓冲像素以**元素自身 rect** 为基准绘制（下方 drawPanel 的
   * transform 就是按 x/y 平移的），内容对元素是锚定的——贴回位置每帧按当前
   * rect 计算（buf.x/y 在进入本函数时已写成本次值），所以位置变化不再失效复用。
   *
   * 复用窗口与旧实现同节奏：静止 PANEL_REUSE_MS + PANEL_REUSE_MAX 每 3 帧强制
   * 重算（工具栏滚动期 140ms）；唯一放宽是视图平移（viewAnimUntil 窗口内）——
   * 面板与光源整体同移、采样相对几何不变，重画纯属浪费，到期由 paint() 的
   * 终态分支 bufGen+1 强制全量收敛。结构代数（bufGen）不同直接禁用复用。
   */
  const now = performance.now();
  const slide = now < ST.viewAnimUntil;
  // 重画节奏 = 旧节奏（每 3 帧/100ms 窗口，配色最新鲜）：GL 栅格后把单次
  // 全量重画的成本压没之后，旧节奏在 60卡/646px 滚动实测 p50=3.4ms
  // p95=11.7ms、>34ms 帧=0（此前 canvas2d 同场景 p95=55/尖峰78）——
  // 「新鲜+顺滑」不再互斥，无需缩频折衷。__vxWin/__vxMax 旋钮保留。
  //
  // 过渡中的面板按 30fps（FADE_FRAME_MS=33）重画：采样时钟（st/ist 插值）长在
  // drawPanel 里，复用会把它冻结——滚动期过渡以 ~100ms 粒度跳变（frameScale
  // 把单步补成 3 倍），观感「一段一段、到地方突然冒出来」。33ms 是旧实现
  // fadePending 续帧链的历史节奏（用户验收过的淡入平滑度）；逐 paint 重画
  // 会让滚动期全量重画每帧都跑（实测 p50 从 3.5ms 涨到 14.4ms），33ms 地板
  // 在两者之间。已收敛的面板照旧走 100ms/MAX2 复用窗（滚动性能主战场）。
  const wasFading = ST.fading.has(el);
  // 工具栏滚动/移动中逐 paint 重画（win=0 永不复用）：描边染色是工具栏
  // 与身下掠过卡片之间逐帧变化的相对几何，任何降频都表现为滞后。
  //
  // 基础面板滚动期按3相错开重画：全部 fading 面板同33ms节奏会在
  // 帧内集中爆发（全量重画 ~10-15ms），超帧 → 该帧画布贴不上 →
  // 描边/泛光整体「慢一拍」。按元素哈希把 fading 面板分到
  // 33/50/67ms 三个相位：每帧只重画 ~1/3，帧成本均匀，不再超帧；
  // 单面板更新仍有15-30fps（时间补偿插值保总收敛时长）。
  const wasFadingWin = wasFading
    ? FADE_FRAME_MS +
      (ST.scrollingNow ? (elHash(el) % 3) * 17 : 0)
    : 0;
  const win = wasFading
    ? wasFadingWin
    : ((globalThis as { __vxWin?: number }).__vxWin ??
      (slide ? PANEL_REUSE_MOTION_MS : PANEL_REUSE_MS));
  const maxReuse =
    wasFading
      ? Number.POSITIVE_INFINITY
      : ((globalThis as { __vxMax?: number }).__vxMax ??
        (slide ? Infinity : PANEL_REUSE_MAX));
  if (
    buf.at > 0 &&
    buf.gen === ST.bufGen &&
    buf.reused < maxReuse &&
    now - buf.at < win
  ) {
    buf.reused += 1;
    return buf;
  }
  // 真正要重画了：记录渲染代数；blit 位置沿用本次写入的当前 rect 值
  buf.gen = ST.bufGen;
  // 距上次真实渲染过了多少个基准步：用于把褪色插值按时间推进（复用不改褪色时长）。
  // 仅当上帧仍在过渡（wasFading）才补偿——那是「过渡途中被跳帧」；上帧已收敛、
  // 本帧刚探测到的新过渡从 1× 步长起步，避免以 3 倍步长起跳形成突变。
  const frameScale =
    wasFading && buf.at > 0 ? (now - buf.at) / FADE_FRAME_MS : 1;
  buf.reused = 0;
  buf.at = now;
  buf.k.setTransform(1, 0, 0, 1, 0, 0);
  buf.k.clearRect(0, 0, buf.c.width, buf.c.height);
  buf.k.setTransform(dpr, 0, 0, dpr, -x * dpr, -y * dpr);
  buf.sk.setTransform(1, 0, 0, 1, 0, 0);
  buf.sk.clearRect(0, 0, buf.sc.width, buf.sc.height);
  buf.sk.setTransform(dpr, 0, 0, dpr, -x * dpr, -y * dpr);
  const d0 = performance.now();
  // 栅格后端选择：Step2 起工具栏走 WebGL（__vxGLTool=false 关）；Step3a 起
  // 基础面板也走（__vxGLBase=false 关）。ST.raster 可整体覆盖（测试用）。
  const g = globalThis as { __vxGLTool?: boolean; __vxGLBase?: boolean };
  const raster =
    ST.raster ??
    ((kind === "tool" && g.__vxGLTool !== false) ||
    (kind === "base" && g.__vxGLBase !== false)
      ? glTintRaster
      : canvas2dRaster);
  ST.toolMoving = kind === "tool" && moved;
  raster.drawPanel(el, buf.k, buf.sk, cards, frameScale);
  const drawMs = performance.now() - d0;
  ST.stats.drawLast = drawMs;
  ST.stats.draws += 1;
  ST.stats.drawSum += drawMs;
  // 本层发生过全量重画（同帧内 paintLayerPair 据此决定层必须重贴）
  ST.lastFullRender[kind] = performance.now();
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
  let next = dirtyForEls(els);
  // 64px 网格对齐（向外取整）：纯平移期脏区尺寸保持稳定、原点按格步进——
  // 配合下方「同尺寸不重分配」，滚动期混合层零纹理分配。
  if (next) {
    const gx = Math.floor(next.x / 64) * 64;
    const gy = Math.floor(next.y / 64) * 64;
    next = {
      x: gx,
      y: gy,
      w: Math.ceil((next.x + next.w) / 64) * 64 - gx,
      h: Math.ceil((next.y + next.h) / 64) * 64 - gy,
    };
  }
  // ── 阶段 A：先推进各面板的复用/全量重画决策 ──
  // 配色时效的时钟在 renderToPanelBuffer 里（复用窗口到期才重算采样），
  // 必须先跑，否则滚动中的采样变化永远不会落到缓冲上（颜色冻结）。
  const rendered = els.map((el) => ({
    el,
    buf: renderToPanelBuffer(el, cards, kind),
  }));
  // ── 内容未变跳过（尖峰归因修复 + 假移动追加）──
  // 本层本 paint 没有全量重画（全复用）+ 无淡入淡出 ⇒ 层画布像素与上帧
  // 完全相同，clear+重贴只是把没变化的纹理再向 GPU 重传一遍（外加混合层
  // 重复上传）。原条件还要求脏区相等——纯平移期脏区每帧都变，导致带
  // 工具栏滚动时工具层每帧“重定位+清+重贴+混合层重传”（实测 p95
  // 8→16）。追加 chased 条件：画布已登记滚动基准时，位置由守卫 translate
  //（假移动补偿）负责，连重定位都可跳过——滚动期混合层纹理零更新。
  const prevDirtyNow = kind === "base" ? ST.prevBaseDirty : ST.prevToolDirty;
  const dirtyEqual =
    !!prevDirtyNow &&
    !!next &&
    prevDirtyNow.x === next.x &&
    prevDirtyNow.y === next.y &&
    prevDirtyNow.w === next.w &&
    prevDirtyNow.h === next.h;
  const chased = ST.paintedScroll.has(c) && ST.paintedScroll.has(sc);
  // 至少有一个可绘 buffer 才能跳过：工具栏滚出可视阈值时 buf 为 null，
  // 若仍走跳过，尾帧会冻结在旧位置（translate 被后续记录清零却没重贴）；
  // 不可绘时落到重定位+清屏路径，顺带清掉残影。
  const anyDrawable = rendered.some(({ buf }) => !!buf);
  // 调试：本层可绘状态（跳过/清屏路径归因）
  (globalThis as { __vxDrawable?: unknown }).__vxDrawable = {
    kind,
    anyDrawable,
    n: els.length,
    skipped:
      els.length > 0 &&
      anyDrawable &&
      ST.lastFullRender[kind] < ST.lastPaintAt &&
      (dirtyEqual || chased),
  };
  if (
    els.length > 0 &&
    anyDrawable &&
    ST.lastFullRender[kind] < ST.lastPaintAt &&
    !els.some((el) => targetVisibility(el) < 0.999) &&
    (dirtyEqual || chased)
  ) {
    ST.stats.layerSkips += 1;
    return;
  }
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
  // 仅尺寸变化才重分配后备存储：**同尺寸的 c.width 赋值同样会销毁+重建
  // 纹理**——原点平移（滚动）曾把它当 geomChanged 每帧触发，混合层纹理
  // 每帧 churn + 重传，带工具栏滚动实测 p50 2.5→5 / p95 8→19ms。
  // 原点变化只重定位 + 清脏区并集 + 重贴（零纹理分配）。
  const realloc = c.width !== bw || c.height !== bh || !prevOrigin;
  c.style.left = `${ox}px`;
  c.style.top = `${oy}px`;
  c.style.width = `${ow}px`;
  c.style.height = `${oh}px`;
  sc.style.left = `${ox}px`;
  sc.style.top = `${oy}px`;
  sc.style.width = `${ow}px`;
  sc.style.height = `${oh}px`;
  if (realloc) {
    // 重新分配后备存储即等于整块清空，首帧/尺寸变化不会有残留旧像素
    c.width = bw;
    c.height = bh;
    sc.width = bw;
    sc.height = bh;
  }
  k.setTransform(dpr, 0, 0, dpr, -ox * dpr, -oy * dpr);
  sk.setTransform(dpr, 0, 0, dpr, -ox * dpr, -oy * dpr);
  const prev = kind === "base" ? ST.prevBaseDirty : ST.prevToolDirty;
  if (!realloc) {
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
  let blitted = false;
  rendered.forEach(({ el, buf }) => {
    if (buf) {
      // 注意：不能引用裸 `toolbar`——TS 会解析成 legacy 的 window.toolbar
      //（恒为真），历史上裁剪分支因此对所有元素执行。按元素真实判断。
      const toolbar = isToolbar(el);
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
      k.drawImage(buf.c, buf.x, buf.y, buf.w, buf.h);
      k.globalAlpha = 1;
      if (toolbar) k.restore();
      if (toolbar) {
        sk.save();
        clipToolbar(sk, vis);
      }
      sk.globalAlpha = fade;
      sk.drawImage(buf.sc, buf.x, buf.y, buf.w, buf.h);
      sk.globalAlpha = 1;
      if (toolbar) sk.restore();
      blitted = true;
      if (toolbar) {
        // 领先帧探针锚点：本次 blit 时工具栏位置与画布原点（视口坐标）——
        // 画布描边的显示位置 = canvas.style.top + translate + (top - originY)
        ST.toolAnchor = { originY: oy, top: r.top };
      }
    }
  });
  // 只有真实重贴过才折算基准：本层可能走到几何路径但无可绘内容（工具栏
  // 被容器裁空等）——此时若记录新基准并清 translate，画布会冻结在旧位置
  // 而守卫按新基准算出零位移（尾帧「停住不跟」的根因）。未重贴时保持
  // translate 与旧基准，守卫继续按旧锚补偿。
  if (blitted) {
    ST.stats.layerBlits += 1;
    const sc0 = scrollContainerOf();
    const base = sc0 ? { left: sc0.scrollLeft, top: sc0.scrollTop } : null;
    for (const cv of [c, sc]) {
      cv.style.removeProperty("translate");
      if (base) ST.paintedScroll.set(cv, base);
      else ST.paintedScroll.delete(cv);
    }
  }
}

// ── 假移动补偿（用户方案）─────────────────────────────────────────
// 滚动时工具栏/面板与卡片的相对位置不变，离屏缓冲像素本来就是对的；
// 唯一变化是绝对位置——纯平移（假移动），不应触发任何重画。守卫每帧
// 把「当前滚动位置 − 画布已绘时的滚动位置」作为 translate 写到混合层
// 画布上：与 DOM 同帧合成，零重画、零延迟；真实光源变化照旧走重画，
// 重画完成时折算归零。
function scrollContainerOf(): HTMLElement | null {
  for (const el of ST.targets) {
    let p: HTMLElement | null = el.parentElement;
    while (p) {
      if (
        p.scrollHeight > p.clientHeight + 8 &&
        /auto|scroll/.test(getComputedStyle(p).overflowY)
      ) {
        return p;
      }
      p = p.parentElement;
    }
  }
  return null;
}

function guardTick(): void {
  ST.guardRaf = 0;
  if (!ST.running) return;
  const sc = scrollContainerOf();
  if (sc) {
    for (const cv of [ST.canvas, ST.shadeCanvas, ST.toolCanvas, ST.toolShadeCanvas]) {
      if (!cv) continue;
      const base = ST.paintedScroll.get(cv);
      if (!base) continue;
      const dx = sc.scrollLeft - base.left;
      const dy = sc.scrollTop - base.top;
      // 符号：画布挂在视口坐标系（不随内容滚动），工具栏随内容滚动——
      // 滚动增量为正（内容上移）时画布必须反向平移才追得上。
      const t =
        Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5
          ? `${-dx}px ${-dy}px`
          : "";
      // 必须走 setProperty/removeProperty 且值用长度对（"0px -40px"）：
      // 1) 本 Chromium 构建里 el.style.translate 驼峰访问器静默失效
      //    （写入丢失）——假移动补偿死过一版的直接死因；
      // 2) translate 属性不接受 transform 函数语法（"translate(0px,-40px)"
      //    是非法值会被整体拒绝），只能给 x y 两个长度。
      if (cv.style.getPropertyValue("translate") !== t) {
        if (t) cv.style.setProperty("translate", t);
        else cv.style.removeProperty("translate");
      }
      // 调试探针：守卫最近一次的计算（领先帧归因）
      (globalThis as { __vxGuard?: unknown }).__vxGuard = {
        dx, dy, t, scroll: sc.scrollTop, base: base.top,
      };
    }
  }
  ST.guardRaf = requestAnimationFrame(guardTick);
}

export function paint(): void {
  ST.raf = 0;
  try {
    if (!ST.running || !ST.targets.size) return;
    ST.fadePending = false;
    // 同一帧内的样式读数缓存：入口整体作废（下方所有 getComputedStyle
    // 复合读数在本次 paint 内只算一次）
    ST.paintCache.clear();
    ST.csCache.clear();
    ST.rootColorCache.clear();
    ST.lastPaintAt = performance.now();
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
    // 续帧一律走 schedule()（rAF，与 vsync 对齐）；旧实现的 setTimeout(16) 不对齐
    // 垂直同步，GPU 空闲时都会抖，GPU 紧张时更是雪上加霜。
    const fadingBase = els.some(
      (el) => !isToolbar(el) && targetVisibility(el) < 0.999,
    );
    const fadingTool = els.some(
      (el) => isToolbar(el) && targetVisibility(el) < 0.999,
    );
    if (fadingBase || fadingTool) {
      window.setTimeout(() => schedule(fadingBase ? "full" : "tool"), 16);
    }
    // driveFor 的截止期：在窗口内无条件逐帧重绘（不依赖采样值），保证 canvas 跟得上 DOM 过渡。
    //（链节奏与旧实现一致：setTimeout(16)——rAF 直连在 400Hz 屏上会让淡出链跑出远超旧版的频率。）
    if (ST.toolAnimUntil > performance.now()) {
      window.setTimeout(() => schedule("tool"), 16);
    } else if (ST.toolAnimUntil) {
      ST.toolAnimUntil = 0;
    }
    if (ST.paintMode === "full" && ST.fadePending) {
      window.setTimeout(() => schedule("full"), 33);
    } else if (
      ST.paintMode === "full" &&
      ST.viewAnimUntil > performance.now()
    ) {
      window.setTimeout(() => schedule("full"), 16);
    }
    if (
      ST.paintMode === "full" &&
      ST.viewAnimUntil &&
      ST.viewAnimUntil <= performance.now()
    ) {
      // 视图平移窗口到期：代数 +1 强制一帧全量重画（平移期复用放宽到 200ms，
      // 终态必须强制收敛；其余场景旧实现直接清标志即可）
      ST.viewAnimUntil = 0;
      ST.bufGen += 1;
      window.setTimeout(() => schedule("full"), 16);
    }
    // 尖峰归因：本次 paint 的 JS 侧总耗时（采样/绘制/调度全含）
    {
      const st = ST.stats;
      st.paintLast = performance.now() - ST.lastPaintAt;
      st.paints += 1;
      st.paintSum += st.paintLast;
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

/**
 * 让绘制循环在接下来 `ms` 毫秒内保持逐帧重绘。
 *
 * 必需的原因：DOM 侧的淡入淡出只改 class/内联样式，**不产生 childList 变更**，
 * 也就不会有 MutationObserver 回调；仅靠"采样到透明度 < 1 再续帧"也不可靠
 * （过渡刚开始那一帧取到的还是起始值 1）。没人推的话，独立图层的 canvas 会一直停在
 * 上一帧，直到元素卸载才被清掉——表现为「canvas 比 DOM 慢一截才消失」。
 *
 * `mode="tool"` 只刷工具栏画布；页面内目标在淡用 `"full"`（底图也在变）。
 */
export function driveFor(ms: number, mode: "tool" | "full" = "tool"): void {
  const until = performance.now() + ms;
  if (mode === "full") ST.viewAnimUntil = Math.max(ST.viewAnimUntil, until);
  else ST.toolAnimUntil = Math.max(ST.toolAnimUntil, until);
  schedule(mode);
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
  // 归因埋点暴露（perf 分支）：CDP 侧读 window.__vxTint.stats 做窗口差分/逐帧配对
  if (typeof window !== "undefined") {
    (window as unknown as Record<string, unknown>).__vxTint = ST;
  }
  window.addEventListener("scroll", onScroll, {
    capture: true,
    passive: true,
  });
  ST.guardRaf = requestAnimationFrame(guardTick);
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
        // 只认 view-stage 元素自身的样式变化（视图切换的滑动动画写在
        // stage 上）。曾用 closest('.view-stage') 把所有后代都算进来——
        // 曲线信息浮窗（curve-tip）逐 mousemove 写 style，每帧都被判成
        // 视图动画 → 每帧全量重画，浮窗帧数被自己的联动拖垮（WebGL
        // 接入后染色常开才暴露）。420ms 驱动链已覆盖切换窗口内的子级
        // 变化，后代逐帧样式无需单触发。
        m.target.classList.contains("view-stage"),
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
      // 卡片增减会改变光源集合，必须重绘一次（原逻辑依赖 300ms 轮询兜底）；
      // 代数 +1 让所有面板缓冲失效——复用窗口放宽后，光靠重绘调度拦不住旧配色滞留
      ST.bufGen += 1;
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
      // 真移动（框选对象改变 = 光源集合变化）：立即全量触发。
      // 工具栏逐帧驱动（本体跟随）；原120ms 防抖是 canvas2d 时代「全量
      // 重画很贵」的遗留——现在未变化面板走复用零成本、变化面板走
      // fading 分相重画，防抖只会给真移动贡献一拍延迟。尾部保留一次
      // 扫描兜底（连续切换时清掉半截状态）。
      driveFor(320, "tool");
      schedule("full");
      window.clearTimeout(ST.selectionTimer);
      ST.selectionTimer = window.setTimeout(() => schedule("full"), 120);
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
  [80, 220, 500].forEach((ms) => window.setTimeout(() => schedule("full"), ms));
}

export function stop(): void {
  ST.running = false;
  if (ST.raf) cancelAnimationFrame(ST.raf);
  ST.raf = 0;
  if (ST.guardRaf) cancelAnimationFrame(ST.guardRaf);
  ST.guardRaf = 0;
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
  ST.toolAnimUntil = 0;
  ST.prevBaseOrigin = null;
  ST.prevToolOrigin = null;
  ST.prevBaseDirty = null;
  ST.prevToolDirty = null;
  ST.themeObserver?.disconnect();
  ST.themeObserver = null;
  ST.layoutObserver?.disconnect();
  ST.layoutObserver = null;
  ST.colorCache = new WeakMap();
  ST.panelBuffers = new WeakMap();
  ST.paintCache.clear();
  ST.csCache.clear();
  ST.rootColorCache.clear();
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
