// rbj.ts 测试（任务 12 后续）：RBJ 双二阶幅度响应 —— 与 driver biquad 对齐的预览曲线。
import { describe, expect, it } from "vitest";
import { bandDb, bandDbCached, peakingDb } from "./rbj";

const FS = 48000;

describe("bandDb", () => {
  it("peaking：中心频率处 ≈ gain_db（正负皆然）", () => {
    expect(bandDb(1000, { fc: 1000, gain_db: 6, q: 1 }, FS)).toBeCloseTo(6, 2);
    expect(bandDb(1000, { fc: 1000, gain_db: -6, q: 1 }, FS)).toBeCloseTo(-6, 2);
  });

  it("gain_db = 0 时处处为 0 dB（纯滤波不改变幅度）", () => {
    for (const f of [20, 100, 1000, 5000, 20000]) {
      expect(Math.abs(bandDb(f, { fc: 1000, gain_db: 0, q: 1 }, FS))).toBeLessThan(1e-9);
    }
  });

  it("peaking：fc 两侧同倍频程距离处响应接近（数字域非严格对称，误差 < 0.05dB）", () => {
    const p = { fc: 1000, gain_db: 6, q: 1 };
    const lo = bandDb(500, p, FS);
    const hi = bandDb(2000, p, FS);
    expect(Math.abs(lo - hi)).toBeLessThan(0.05);
    expect(lo).toBeGreaterThan(0);
    expect(hi).toBeGreaterThan(0);
  });

  it("low_shelf：低频端接近增益、远高频接近 0", () => {
    const p = { fc: 100, gain_db: 6, q: 0.707, kind: "low_shelf" as const };
    expect(bandDb(20, p, FS)).toBeGreaterThan(4.5);
    expect(bandDb(20, p, FS)).toBeLessThan(6.5);
    expect(Math.abs(bandDb(20000, p, FS))).toBeLessThan(0.5);
  });

  it("high_shelf：高频端接近增益、远低频接近 0", () => {
    const p = { fc: 8000, gain_db: 6, q: 0.707, kind: "high_shelf" as const };
    expect(bandDb(20000, p, FS)).toBeGreaterThan(4);
    expect(Math.abs(bandDb(20, p, FS))).toBeLessThan(0.5);
  });

  it("low_pass / high_pass：增益作用于通带", () => {
    expect(bandDb(20, { fc: 1000, gain_db: 3, q: 0.707, kind: "low_pass" }, FS)).toBeCloseTo(3, 1);
    expect(bandDb(20000, { fc: 1000, gain_db: 3, q: 0.707, kind: "high_pass" }, FS)).toBeCloseTo(3, 1);
  });

  it("缺省 kind 等价于 peaking", () => {
    const p = { fc: 1000, gain_db: 3, q: 1 };
    expect(bandDb(700, p, FS)).toBe(peakingDb(700, p.fc, p.gain_db, p.q, FS));
  });

  it("越界参数被夹紧（freq/fc/Q）而不抛错", () => {
    expect(Number.isFinite(bandDb(1e6, { fc: 1e6, gain_db: 3, q: 0 }, FS))).toBe(true);
    expect(Number.isFinite(bandDb(1, { fc: 1, gain_db: 3, q: 1e3 }, FS))).toBe(true);
  });
});

describe("bandDbCached", () => {
  it("与 bandDb 同值（缓存不改变结果）", () => {
    const b = { fc: 1000, gain_db: 4, q: 1.2 };
    for (const f of [100, 1000, 4000]) {
      expect(bandDbCached(f, b, FS)).toBe(bandDb(f, b, FS));
    }
  });

  it("按 band 对象身份 + 采样率分层，复用同一份结果", () => {
    const b = { fc: 1000, gain_db: 4, q: 1.2 };
    expect(bandDbCached(1000, b, FS)).toBe(bandDbCached(1000, b, FS));
    expect(bandDbCached(1000, b, 44100)).toBe(bandDb(1000, b, 44100));
  });
});
