// 边缘染色的目标扫描与观察者注册：卡片节点扫描、ResizeObserver 绑定、自动扫描（决策 5 阶段 A
// 第四批，从 hooks/useEdgeTintLayer.ts 原样搬出，行为零变化；状态经 state.ts 的 ST 共享）。

import { MAX_SOURCE_R, buildGrid, rgbLuminance, surfaceLumOf } from "./geometry";
import type { ColorSource, LumSource } from "./geometry";
import type { CardNode, LightSet } from "./primitives";
import { ST } from "./state";
import { ensureCanvas } from "./canvasPool";
import { cardColor, curvePointSources } from "./tint";
import { schedule, start, stop } from "./renderLoop";

export function refreshCardNodes(): CardNode[] {
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

export function collectCards(): LightSet {
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

/** 注册绘制目标；返回是否真的新增了目标（用于决定是否需要重绘）。 */
export function registerTarget(el: HTMLElement): boolean {
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

export function removeTarget(el: HTMLElement): void {
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

export function syncTargets(): void {
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
export function targetScanSignature(): string {
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
export function startAuto(): void {
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

export function stopAuto(): void {
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
