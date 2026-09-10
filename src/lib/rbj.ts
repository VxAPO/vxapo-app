import type { PeqBandKind } from "./model";

/** RBJ 双二阶幅度响应（dB）——与 driver biquad 计算对齐（app 曲线预览用）。 */

export function peakingDb(freq: number, fc: number, gainDb: number, q: number, fs: number): number {
  const f = Math.max(10, Math.min(fs * 0.49, freq));
  const center = Math.max(10, Math.min(fs * 0.49, fc));
  const qq = Math.max(0.1, Math.min(20, q));
  const a = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * center) / fs;
  const cw = Math.cos(w0);
  const sw = Math.sin(w0);
  const alpha = sw / (2 * qq);
  const b0 = 1 + alpha * a;
  const b1 = -2 * cw;
  const b2 = 1 - alpha * a;
  const a0 = 1 + alpha / a;
  const a1 = -2 * cw;
  const a2 = 1 - alpha / a;
  const w = (2 * Math.PI * f) / fs;
  const c = Math.cos(w);
  const s = Math.sin(w);
  const c2 = Math.cos(2 * w);
  const s2 = Math.sin(2 * w);
  const num = Math.hypot(b0 + b1 * c + b2 * c2, b1 * s + b2 * s2);
  const den = Math.hypot(a0 + a1 * c + a2 * c2, a1 * s + a2 * s2);
  return 20 * Math.log10(num / den);
}

function biquadDb(
  freq: number,
  fs: number,
  b0: number,
  b1: number,
  b2: number,
  a0: number,
  a1: number,
  a2: number,
): number {
  const f = Math.max(10, Math.min(fs * 0.49, freq));
  const w = (2 * Math.PI * f) / fs;
  const c = Math.cos(w);
  const s = Math.sin(w);
  const c2 = Math.cos(2 * w);
  const s2 = Math.sin(2 * w);
  const num = Math.hypot(b0 + b1 * c + b2 * c2, b1 * s + b2 * s2);
  const den = Math.hypot(a0 + a1 * c + a2 * c2, a1 * s + a2 * s2);
  return 20 * Math.log10(num / den);
}

function lowPassDb(freq: number, fc: number, gainDb: number, q: number, fs: number): number {
  const center = Math.max(10, Math.min(fs * 0.49, fc));
  const qq = Math.max(0.1, Math.min(20, q));
  const lin = Math.pow(10, gainDb / 20);
  const w0 = (2 * Math.PI * center) / fs;
  const cw = Math.cos(w0);
  const sw = Math.sin(w0);
  const alpha = sw / (2 * qq);
  // 增益作用于通带：分子乘线性增益（与 driver biquad 一致，0 dB 纯滤波）。
  const b0 = ((1 - cw) / 2) * lin;
  const b1 = (1 - cw) * lin;
  const b2 = ((1 - cw) / 2) * lin;
  const a0 = 1 + alpha;
  const a1 = -2 * cw;
  const a2 = 1 - alpha;
  return biquadDb(freq, fs, b0, b1, b2, a0, a1, a2);
}

function highPassDb(freq: number, fc: number, gainDb: number, q: number, fs: number): number {
  const center = Math.max(10, Math.min(fs * 0.49, fc));
  const qq = Math.max(0.1, Math.min(20, q));
  const lin = Math.pow(10, gainDb / 20);
  const w0 = (2 * Math.PI * center) / fs;
  const cw = Math.cos(w0);
  const sw = Math.sin(w0);
  const alpha = sw / (2 * qq);
  const b0 = ((1 + cw) / 2) * lin;
  const b1 = -(1 + cw) * lin;
  const b2 = ((1 + cw) / 2) * lin;
  const a0 = 1 + alpha;
  const a1 = -2 * cw;
  const a2 = 1 - alpha;
  return biquadDb(freq, fs, b0, b1, b2, a0, a1, a2);
}

function lowShelfDb(freq: number, fc: number, gainDb: number, q: number, fs: number): number {
  const center = Math.max(10, Math.min(fs * 0.49, fc));
  const qq = Math.max(0.1, Math.min(20, q));
  const A = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * center) / fs;
  const cw = Math.cos(w0);
  const sw = Math.sin(w0);
  const alpha = sw / (2 * qq);
  const sqrtA = Math.sqrt(A);
  const b0 = A * ((A + 1) - (A - 1) * cw + 2 * sqrtA * alpha);
  const b1 = 2 * A * ((A - 1) - (A + 1) * cw);
  const b2 = A * ((A + 1) - (A - 1) * cw - 2 * sqrtA * alpha);
  const a0 = (A + 1) + (A - 1) * cw + 2 * sqrtA * alpha;
  const a1 = -2 * ((A - 1) + (A + 1) * cw);
  const a2 = (A + 1) + (A - 1) * cw - 2 * sqrtA * alpha;
  return biquadDb(freq, fs, b0, b1, b2, a0, a1, a2);
}

function highShelfDb(freq: number, fc: number, gainDb: number, q: number, fs: number): number {
  const center = Math.max(10, Math.min(fs * 0.49, fc));
  const qq = Math.max(0.1, Math.min(20, q));
  const A = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * center) / fs;
  const cw = Math.cos(w0);
  const sw = Math.sin(w0);
  const alpha = sw / (2 * qq);
  const sqrtA = Math.sqrt(A);
  const b0 = A * ((A + 1) + (A - 1) * cw + 2 * sqrtA * alpha);
  const b1 = -2 * A * ((A - 1) + (A + 1) * cw);
  const b2 = A * ((A + 1) + (A - 1) * cw - 2 * sqrtA * alpha);
  const a0 = (A + 1) - (A - 1) * cw + 2 * sqrtA * alpha;
  const a1 = 2 * ((A - 1) - (A + 1) * cw);
  const a2 = (A + 1) - (A - 1) * cw - 2 * sqrtA * alpha;
  return biquadDb(freq, fs, b0, b1, b2, a0, a1, a2);
}

/** 按 band.kind 计算幅度响应（缺省 peaking），与 driver RBJ biquad 对齐。 */
export function bandDb(
  freq: number,
  band: { fc: number; gain_db: number; q: number; kind?: PeqBandKind },
  fs: number,
): number {
  switch (band.kind ?? "peaking") {
    case "low_shelf":
      return lowShelfDb(freq, band.fc, band.gain_db, band.q, fs);
    case "high_shelf":
      return highShelfDb(freq, band.fc, band.gain_db, band.q, fs);
    case "low_pass":
      return lowPassDb(freq, band.fc, band.gain_db, band.q, fs);
    case "high_pass":
      return highPassDb(freq, band.fc, band.gain_db, band.q, fs);
    case "peaking":
    default:
      return peakingDb(freq, band.fc, band.gain_db, band.q, fs);
  }
}

/**
 * band 响应缓存：按 band 对象身份 + 采样率分层，value = f→dB 稀疏表。
 * blocks 每次编辑都会产生新对象，旧对象由 WeakMap 自动回收：
 * 既保留「编辑单个 band 只重算它自己」的收益，也不会因为键数量超限而整体清空、
 * 让未改动的 30 段一起重算。曲线路径 / 峰值谷值 / 悬停共用同一份缓存。
 */
const bandResponseCache = new WeakMap<object, Map<number, Map<number, number>>>();

export function bandDbCached(
  freq: number,
  band: { fc: number; gain_db: number; q: number; kind?: PeqBandKind },
  fs: number,
): number {
  let byFs = bandResponseCache.get(band);
  if (!byFs) {
    byFs = new Map();
    bandResponseCache.set(band, byFs);
  }
  let m = byFs.get(fs);
  if (!m) {
    m = new Map();
    byFs.set(fs, m);
  }
  let v = m.get(freq);
  if (v === undefined) {
    v = bandDb(freq, band, fs);
    m.set(freq, v);
  }
  return v;
}
