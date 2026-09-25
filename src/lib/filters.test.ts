// 通道过滤判据（两个视图 + 曲线 + 落盘口径共用同一条）。
import { describe, expect, it } from "vitest";
import type { Block } from "./model";
import { visibleBlockFor, visibleBlocksFor } from "./filters";

function block(id: string, channel?: string): Block {
  return { id, enabled: true, channel, bands: [{ fc: 1000, gain_db: 0, q: 1 }] };
}

const L = block("l", "L");
const R = block("r", "R");
const free = block("free");

describe("visibleBlockFor / visibleBlocksFor", () => {
  it("通道模式开：只看当前声道，无声道标识的块归首声道", () => {
    expect(visibleBlockFor(L, true, "L", "L")).toBe(true);
    expect(visibleBlockFor(R, true, "L", "L")).toBe(false);
    expect(visibleBlockFor(free, true, "L", "L")).toBe(true); // 无标识 = 首声道
    expect(visibleBlockFor(R, true, "L", "R")).toBe(true);
    expect(visibleBlockFor(free, true, "L", "R")).toBe(false);
  });

  it("通道模式关：回退首声道（active 不参与判定），其它声道的块不显示", () => {
    expect(visibleBlockFor(L, false, "L", "R")).toBe(true);
    expect(visibleBlockFor(free, false, "L", "R")).toBe(true);
    expect(visibleBlockFor(R, false, "L", "R")).toBe(false);
  });

  it("列表版与单块判据同源", () => {
    expect(visibleBlocksFor([L, R, free], false, "L", "L").map((b) => b.id)).toEqual(["l", "free"]);
    expect(visibleBlocksFor([L, R, free], true, "L", "R").map((b) => b.id)).toEqual(["r"]);
  });
});
