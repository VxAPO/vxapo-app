import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ANIM_SETTLE_BUFFER_MS,
  ENTER_DEBOUNCE_MS,
  FLY_ANIM_MS,
  FLY_HANDOVER_MS,
  FLY_HOLD_MS,
  FLY_MOVE_MS,
  FLY_MOVE_RATIO,
  FLY_TAIL_MS,
  FLY_TOTAL_MS,
  LAYOUT_ANIM_MS,
  LAYOUT_ANIM_OUTSIDE_MS,
  LAYOUT_EASE,
} from "./dragSortTypes";
import { EASE_OUT_SOFT } from "./motionEase";
import { COLLAPSE_EASE } from "./viewMotion";
import { Z_TOOL_SHADE } from "./edgetint/geometry";

/**
 * 拖拽时序契约的机械断言：这些关系散落在注释里，靠人记迟早漂移，
 * 用测试钉住（改时长/曲线时先看这里为什么这么定）。
 */
describe("拖拽时序契约", () => {
  it("进入槽位的消抖必须长于布局动画 + 落地缓冲", () => {
    expect(ENTER_DEBOUNCE_MS).toBeGreaterThan(LAYOUT_ANIM_MS + ANIM_SETTLE_BUFFER_MS);
  });

  it("槽位外补位比槽位内避让更快", () => {
    expect(LAYOUT_ANIM_OUTSIDE_MS).toBeLessThan(LAYOUT_ANIM_MS);
  });

  it("落地总时长 = 动画 + 无阴影停顿 + 缓冲", () => {
    expect(FLY_TOTAL_MS).toBe(FLY_ANIM_MS + FLY_HOLD_MS + FLY_TAIL_MS);
  });

  it("位置段按比例截在总动画之内，交接在其之后、动画之内", () => {
    expect(FLY_MOVE_MS).toBe(Math.round(FLY_ANIM_MS * FLY_MOVE_RATIO));
    expect(FLY_MOVE_MS).toBeLessThan(FLY_ANIM_MS);
    expect(FLY_HANDOVER_MS).toBeGreaterThan(FLY_MOVE_MS);
    expect(FLY_HANDOVER_MS).toBeLessThanOrEqual(FLY_ANIM_MS);
  });

  it("拖拽避让曲线与视图收窄曲线同源", () => {
    expect(LAYOUT_EASE).toBe(EASE_OUT_SOFT);
    expect(COLLAPSE_EASE).toBe(EASE_OUT_SOFT);
  });

  it("落地灰条动画不超过飞行时长（副本卸载前必须跑完）", () => {
    const css = readFileSync(
      fileURLToPath(new URL("../styles/curve.css", import.meta.url)),
      "utf8",
    );
    const m = /drag-bar-land\s+([\d.]+)s/.exec(css);
    expect(m).not.toBeNull();
    const cssMs = Number(m![1]) * 1000;
    expect(cssMs).toBeLessThanOrEqual(FLY_ANIM_MS);
    expect(cssMs).toBeLessThanOrEqual(FLY_TOTAL_MS);
  });

  it("飞行副本的层级：压过染色层，并被设备标签栏遮住", () => {
    const read = (p: string) =>
      readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8");

    // 副本要压过染色 canvas，否则会被当成背景染色蒙住
    const flyZ = Number(/\.drag-fly\.fly-anim\s*\{[^}]*?z-index:\s*(\d+)/.exec(read("../styles/curve.css"))?.[1]);
    expect(flyZ).toBeGreaterThan(Z_TOOL_SHADE);

    // 副本挂进滚动内容层后，层级只在 .device-body 这个层叠上下文内比较；
    // 该上下文必须低于标签栏（.tab-bar），这才是「副本被标签栏遮住」的机制。
    // 一旦 .device-body 丢了 z-index: 0，副本的 z-index 就会拿到根上下文去比，直接盖住标签栏。
    const bodyBlock = /\.device-body\s*\{[^}]*\}/.exec(read("../styles/device.css"))?.[0] ?? "";
    expect(bodyBlock).toMatch(/position:\s*relative/);
    const bodyZ = Number(/z-index:\s*(\d+)/.exec(bodyBlock)?.[1]);
    const tabZ = Number(/\.tab-bar\s*\{[^}]*?z-index:\s*(\d+)/.exec(read("../styles/tabs.css"))?.[1]);
    expect(bodyZ).toBeLessThan(tabZ);

    // 滚动容器上这个 transform 是「悬浮层被内容区边界裁掉、同时不随滚动位移」的前提，别顺手删掉
    const scrollBlock = /\.tuning-scroll\s*\{[^}]*\}/.exec(read("../styles/device.css"))?.[0] ?? "";
    expect(scrollBlock).toMatch(/transform:\s*translateZ\(0\)/);
  });
});
