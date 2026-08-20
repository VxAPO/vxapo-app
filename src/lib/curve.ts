import type { Block } from "./model";
import { bandDb } from "./rbj";

/** 对数 X 坐标：20Hz → 40，20kHz → curveW-40（视口 220 高）。 */
export function logX(freq: number, w: number): number {
  const t = (Math.log10(Math.max(20, Math.min(20000, freq))) - Math.log10(20)) / 3;
  return 40 + t * (w - 80);
}

/** dB → 视口 Y 坐标（top → 24，bottom → 204）。 */
export function dbY(db: number, top: number, bottom: number): number {
  const span = Math.max(1, top - bottom);
  return 24 + ((top - db) / span) * 180;
}

/**
 * 峰值评估频率点：全局对数扫描 + 频段中心 + 高 Q 邻域细化 + 相邻中心中点。
 * 曲线路径与 y 轴峰值共用，避免高 Q 窄峰落在粗网格之间被画平。
 */
export function buildEvalFreqs(blocks: Block[]): number[] {
  const enabledBands = blocks.filter((b) => b.enabled).flatMap((b) => b.bands);
  const freqs = new Set<number>();
  for (let i = 0; i <= 480; i++) freqs.add(20 * Math.pow(1000, i / 480));
  if (!enabledBands.length) return [...freqs];
  const centers = enabledBands
    .map((band) => ({
      fc: Math.min(20000, Math.max(20, band.fc)),
      q: Math.min(20, Math.max(0.1, band.q)),
    }))
    .sort((a, b) => a.fc - b.fc);
  for (const { fc, q } of centers) {
    freqs.add(fc);
    if (q > 3) {
      // 半功率半宽 ≈ fc 附近 log10(1 + 1/(2q)) decades，细化覆盖 ±2 倍半宽
      const half = Math.log10(1 + 1 / (2 * q));
      const lo = Math.max(20, fc * Math.pow(10, -2 * half));
      const hi = Math.min(20000, fc * Math.pow(10, 2 * half));
      for (let i = 1; i < 24; i++) freqs.add(lo * Math.pow(hi / lo, i / 24));
    }
  }
  for (let i = 1; i < centers.length; i++) {
    freqs.add(Math.sqrt(centers[i - 1].fc * centers[i].fc));
  }
  // 必须按频率升序返回：细化点是网格之后插入的，路径按数组顺序连线，
  // 不排序会导致每个峰与 20k 之间多出一条连线。
  return [...freqs].sort((a, b) => a - b);
}

/** 所有启用频段在给定统一平移量下，整条曲线的真实峰值（dB）。 */
export function curveMax(freqs: number[], blocks: Block[], fs: number, preampGainDb = 0): number {
  let m = -Infinity;
  for (const f of freqs) {
    let db = preampGainDb;
    for (const b of blocks) {
      if (!b.enabled) continue;
      for (const band of b.bands) db += bandDb(f, band, fs);
    }
    if (db > m) m = db;
  }
  return m;
}

/** 整条曲线的最小值（dB）——Y 轴负侧自适应展宽依据。 */
export function curveMin(freqs: number[], blocks: Block[], fs: number, preampGainDb = 0): number {
  let m = Infinity;
  for (const f of freqs) {
    let db = preampGainDb;
    for (const b of blocks) {
      if (!b.enabled) continue;
      for (const band of b.bands) db += bandDb(f, band, fs);
    }
    if (db < m) m = db;
  }
  return m;
}
