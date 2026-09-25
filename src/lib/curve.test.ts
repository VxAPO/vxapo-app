// curve.ts 测试（任务 12 后续）：坐标映射、评估频率点、峰值/谷值。
import { describe, expect, it } from "vitest";
import {
  axisRange,
  buildEvalFreqs,
  curveMax,
  curveMin,
  curveRange,
  dbY,
  logX,
  yStepFor,
} from "./curve";
import type { Band, Block } from "./model";

const FS = 48000;

function band(over: Partial<Band> = {}): Band {
  return { fc: 1000, gain_db: 0, q: 1, ...over };
}

function blk(bands: Band[], enabled = true): Block {
  return { enabled, bands };
}

describe("logX / dbY", () => {
  it("对数轴：20Hz→40、20kHz→w-40，每十倍频程等距", () => {
    const w = 1000;
    expect(logX(20, w)).toBeCloseTo(40, 6);
    expect(logX(20000, w)).toBeCloseTo(960, 6);
    const [a, b, c, d] = [20, 200, 2000, 20000].map((f) => logX(f, w));
    expect(b - a).toBeCloseTo(c - b, 6);
    expect(c - b).toBeCloseTo(d - c, 6);
  });

  it("越界频率被夹紧到 20–20k", () => {
    expect(logX(5, 1000)).toBeCloseTo(logX(20, 1000), 10);
    expect(logX(40000, 1000)).toBeCloseTo(logX(20000, 1000), 10);
  });

  it("dB → Y：上边界 24、下边界 204、中点为 114", () => {
    expect(dbY(12, 12, -12)).toBeCloseTo(24, 6);
    expect(dbY(-12, 12, -12)).toBeCloseTo(204, 6);
    expect(dbY(0, 12, -12)).toBeCloseTo(114, 6);
  });

  it("top == bottom 时 span 兜底为 1，结果仍有限", () => {
    expect(Number.isFinite(dbY(0, 5, 5))).toBe(true);
  });
});

describe("buildEvalFreqs", () => {
  it("无频段时只给全局网格：481 点、升序、端点 20–20k", () => {
    const freqs = buildEvalFreqs([]);
    expect(freqs).toHaveLength(481);
    expect(freqs[0]).toBeCloseTo(20, 6);
    expect(freqs[freqs.length - 1]).toBeCloseTo(20000, 4);
    expect([...freqs].sort((a, b) => a - b)).toEqual(freqs);
  });

  it("包含各频段中心频率与相邻中心的中点", () => {
    const freqs = buildEvalFreqs([blk([band({ fc: 500 }), band({ fc: 2000 })])]);
    expect(freqs).toContain(500);
    expect(freqs).toContain(2000);
    expect(freqs).toContain(1000); // sqrt(500 × 2000)
  });

  it("高 Q 频段插入邻域细化点（点数多于低 Q）", () => {
    const lowQ = buildEvalFreqs([blk([band({ fc: 1000, q: 1 })])]);
    const highQ = buildEvalFreqs([blk([band({ fc: 1000, q: 10 })])]);
    expect(highQ.length).toBeGreaterThan(lowQ.length);
  });

  it("禁用块的频段不参与（结果与空频段一致）", () => {
    const disabled = buildEvalFreqs([blk([band({ fc: 1234, q: 10 })], false)]);
    expect(disabled).toEqual(buildEvalFreqs([]));
  });
});

describe("curveMax / curveMin / curveRange", () => {
  it("峰值 ≈ 频段增益，统一平移量整体抬升", () => {
    const b = band({ fc: 1000, gain_db: 6, q: 1 });
    const blocks = [blk([b])];
    const freqs = buildEvalFreqs(blocks);
    expect(curveMax(freqs, blocks, FS)).toBeCloseTo(6, 1);
    expect(curveMax(freqs, blocks, FS, -6)).toBeCloseTo(0, 1);
    expect(curveMin(freqs, blocks, FS, -6)).toBeCloseTo(curveMin(freqs, blocks, FS) - 6, 1);
  });

  it("频段越陡峰值越贴近标称增益（Q 大 → 峰更集中）", () => {
    const wide = band({ fc: 1000, gain_db: 6, q: 0.5 });
    const narrow = band({ fc: 1000, gain_db: 6, q: 8 });
    const f1 = buildEvalFreqs([blk([wide])]);
    const f2 = buildEvalFreqs([blk([narrow])]);
    expect(curveMax(f1, [blk([wide])], FS)).toBeCloseTo(6, 1);
    expect(curveMax(f2, [blk([narrow])], FS)).toBeCloseTo(6, 1);
  });

  it("curveRange 与分别求 max/min 同值（一遍扫描不改变结果）", () => {
    const b = band({ fc: 120, gain_db: -4, q: 0.7, kind: "low_shelf" });
    const blocks = [blk([b])];
    const freqs = buildEvalFreqs(blocks);
    const r = curveRange(freqs, blocks, FS, 2);
    expect(r.max).toBeCloseTo(curveMax(freqs, blocks, FS, 2), 10);
    expect(r.min).toBeCloseTo(curveMin(freqs, blocks, FS, 2), 10);
  });

  it("禁用的块不产生任何响应", () => {
    expect(curveMax([1000], [blk([band({ gain_db: 6 })], false)], FS)).toBe(0);
  });

  it("空输入时 curveRange 返回 0/0（防 -Infinity 泄漏到 UI）", () => {
    expect(curveRange([], [], FS)).toEqual({ min: 0, max: 0 });
  });
});

describe("axisRange", () => {
  it("量程对齐到步长整数倍：网格首末两条能压住绘图区上下沿", () => {
    // 峰值 +4 / 谷值 -26：按 2dB 档先取 6 / -28，跨度 34 → 步长 4 → 对齐成 8 / -28
    const r = axisRange(4, -26);
    expect(r.step).toBe(4);
    expect(r.top).toBe(8);
    expect(r.bottom).toBe(-28);
    // 对齐后首末两条网格线正好落在绘图区顶沿 / 底沿（从前 floor 会缩进来半格）
    expect(dbY(r.top, r.top, r.bottom)).toBeCloseTo(24, 6);
    expect(dbY(r.bottom, r.top, r.bottom)).toBeCloseTo(204, 6);
  });

  it("0dB 必然落在刻度线上（对齐后两端都是步长倍数）", () => {
    for (const [peak, trough] of [
      [4, -26],
      [0, -10],
      [12, -12],
      [-2, -18],
      [20, -30],
    ] as const) {
      const r = axisRange(peak, trough);
      expect(r.top % r.step).toBe(0);
      expect(Math.abs(r.bottom) % r.step).toBe(0);
      expect(0 % r.step).toBe(0);
    }
  });

  it("量程永远包得住峰值 / 谷值（对齐只放大、不切断）", () => {
    for (const [peak, trough] of [
      [4, -26],
      [9, -3],
      [30, -30],
      [0, 0],
    ] as const) {
      const r = axisRange(peak, trough);
      expect(r.top).toBeGreaterThanOrEqual(peak);
      expect(r.bottom).toBeLessThanOrEqual(trough);
    }
  });

  it("步长与跨度绑定：小量程 2dB、大量程 4dB", () => {
    expect(yStepFor(6, -6)).toBe(2);
    expect(yStepFor(14, -14)).toBe(4);
  });

  it("无峰无谷时仍保持最小量程（曲线不被压扁）", () => {
    const r = axisRange(0, 0);
    expect(r.top).toBeGreaterThanOrEqual(6);
    expect(r.bottom).toBeLessThanOrEqual(-6);
  });
});
