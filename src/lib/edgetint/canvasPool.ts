// 边缘染色的画布池：主/工具栏/阴影/超采样画布的创建、尺寸与层级（决策 5 阶段 A 第四批，
// 从 hooks/useEdgeTintLayer.ts 原样搬出，行为零变化；状态经 state.ts 的 ST 共享）。

import { Z_BASE, Z_SHADE, Z_TOOL, Z_TOOL_SHADE } from "./geometry";
import { ST } from "./state";

export function makeLayer(
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

export function ensureCanvas(h: HTMLElement | null = null): void {
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

export function ensureSoftCanvas(w: number, h: number): void {
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

export function ensureSsCanvas(w: number, h: number): void {
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
