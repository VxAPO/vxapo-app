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
});
