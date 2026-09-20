// normalize.ts 测试（任务 12 后续）：整链增益归一化计算（纯函数）。
import { describe, expect, it } from "vitest";
import { planNormalize } from "./normalize";
import type { Band, Block, EffectItem } from "./model";

const FS = 48000;

function band(over: Partial<Band> = {}): Band {
  return { fc: 1000, gain_db: 0, q: 1, ...over };
}

function blk(over: Partial<Block> = {}): Block {
  return { id: "b", enabled: true, bands: [band({ gain_db: 6 })], ...over };
}

function preamp(over: Partial<EffectItem> = {}): EffectItem {
  return { id: "preamp:all", type: "preamp", enabled: true, params: { gain_db: 0 }, ...over };
}

describe("planNormalize（非通道模式）", () => {
  it("整链峰值取负写入 preamp:all", () => {
    const blocks = [blk()];
    const { updates, channeled } = planNormalize(blocks, [], ["L"], false, FS);
    expect(channeled).toBe(false);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ id: "preamp:all" });
    expect(updates[0].channels).toBeUndefined();
    expect(updates[0].gain_db).toBeCloseTo(-6, 1);
  });

  it("当前基准电平计入总峰值：+6 增益 + (-6) 基准 ≈ 0 → 不更新", () => {
    const blocks = [blk()];
    const effects = [preamp({ params: { gain_db: -6 } })];
    expect(planNormalize(blocks, effects, ["L"], false, FS).updates).toHaveLength(0);
  });

  it("无峰值（空链、纯衰减）不产生更新", () => {
    expect(planNormalize([], [], ["L"], false, FS).updates).toHaveLength(0);
    expect(
      planNormalize([blk({ bands: [band({ gain_db: -6 })] })], [], ["L"], false, FS).updates,
    ).toHaveLength(0);
  });

  it("损失按 0.1 dB 取整", () => {
    const { updates } = planNormalize([blk({ bands: [band({ gain_db: 6.04 })] })], [], ["L"], false, FS);
    expect(updates[0].gain_db).toBe(Math.round(updates[0].gain_db * 10) / 10);
  });
});

describe("planNormalize（通道模式）", () => {
  it("按声道分组：缺 channel 的块归入第一声道", () => {
    const blocks = [
      blk({ id: "L1", channel: "L", bands: [band({ gain_db: 4 })] }),
      blk({ id: "R1", channel: "R", bands: [band({ gain_db: 3 })] }),
      blk({ id: "none", bands: [band({ gain_db: 2 })] }),
    ];
    const { updates, channeled } = planNormalize(blocks, [], ["L", "R"], true, FS);
    expect(channeled).toBe(true);
    const byId = new Map(updates.map((u) => [u.id, u]));
    expect([...byId.keys()].sort()).toEqual(["preamp:L", "preamp:R"]);
    // L 组含 L1(4dB) + none(2dB)，两者中心频率相同 → 峰值 ≈ 6dB
    expect(byId.get("preamp:L")?.gain_db).toBeCloseTo(-6, 1);
    expect(byId.get("preamp:L")?.channels).toEqual(["L"]);
    expect(byId.get("preamp:R")?.gain_db).toBeCloseTo(-3, 1);
    expect(byId.get("preamp:R")?.channels).toEqual(["R"]);
  });

  it("声道列表外的声道（配置里出现）也会归一化", () => {
    const blocks = [blk({ channel: "C", bands: [band({ gain_db: 5 })] })];
    const { updates } = planNormalize(blocks, [], ["L", "R"], true, FS);
    expect(updates.map((u) => u.id)).toEqual(["preamp:C"]);
    expect(updates[0].gain_db).toBeCloseTo(-5, 1);
  });

  it("该声道的 preamp 已存在时沿用其 id（更新而非新增）", () => {
    const blocks = [blk({ channel: "L" })];
    const effects = [preamp({ id: "preamp:L", channels: ["L"], params: { gain_db: 0 } })];
    const { updates } = planNormalize(blocks, effects, ["L"], true, FS);
    expect(updates).toHaveLength(1);
    expect(updates[0].id).toBe("preamp:L");
  });

  it("通道模式只看该声道自己的 preamp（全局 preamp 不参与）", () => {
    const blocks = [blk({ channel: "L" })];
    const effects = [preamp({ params: { gain_db: -6 } })]; // 无 channels → 全局
    const { updates } = planNormalize(blocks, effects, ["L"], true, FS);
    expect(updates[0].gain_db).toBeCloseTo(-6, 1);
  });
});
