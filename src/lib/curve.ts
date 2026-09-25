import type { Block } from "./model";
import { bandDbCached } from "./rbj";

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

/** 纵轴量程的步长分界：跨度超过它就用 4dB 一格，否则 2dB。 */
export const Y_STEP_SPAN = 26;
/** 纵轴量程的软边界：低于 6 曲线被压得过扁，高于 30 曲线挤成一条。 */
export const Y_RANGE_MIN = 6;
export const Y_RANGE_MAX = 30;

/** 纵轴刻度步长（与量程跨度绑定，`CurveGrid` 与 `axisRange` 必须同规则）。 */
export function yStepFor(top: number, bottom: number): number {
  return top - bottom > Y_STEP_SPAN ? 4 : 2;
}

/**
 * 纵轴量程：按峰值/谷值取整到 2dB 档，再**对齐到刻度步长的整数倍**。
 *
 * 为什么必须对齐到步长：网格线与刻度是按步长一路铺下来的，量程若不是步长的整数倍，
 * 最上面一条网格线就压不到绘图区顶沿（绘制侧只能 `floor`，于是缩进来半格），刻度标签随之整体
 * 偏移——观感就是「虚线没贴住纵轴顶端、数字莫名往下偏」。对齐之后各端点都落在步长倍数上；
 * 0dB 是任意步长的倍数，于是也必然正好落在某条刻度线上（跨度的段数奇偶都成立）。
 *
 * 步长本身由量程跨度决定，对齐可能小幅放宽量程、从而跨过 `Y_STEP_SPAN` 这个界，故迭代两次收敛；
 * 软边界 6..30 只约束第一步，对齐允许小幅超出。
 */
export function axisRange(
  peakGain: number,
  troughGain: number,
): { top: number; bottom: number; step: number } {
  let top = Math.max(Y_RANGE_MIN, Math.min(Y_RANGE_MAX, Math.ceil((peakGain + 1) / 2) * 2));
  let bottom = Math.min(
    -Y_RANGE_MIN,
    Math.max(-Y_RANGE_MAX, Math.floor((troughGain - 1) / 2) * 2),
  );
  for (let i = 0; i < 2; i++) {
    const step = yStepFor(top, bottom);
    const alignedTop = Math.ceil(top / step) * step;
    const alignedBottom = Math.floor(bottom / step) * step;
    if (alignedTop === top && alignedBottom === bottom) break;
    top = alignedTop;
    bottom = alignedBottom;
  }
  return { top, bottom, step: yStepFor(top, bottom) };
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
      for (const band of b.bands) db += bandDbCached(f, band, fs);
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
      for (const band of b.bands) db += bandDbCached(f, band, fs);
    }
    if (db < m) m = db;
  }
  return m;
}

/** 一遍循环同时求峰值与谷值（比分别调 curveMax/curveMin 少一遍全量扫描）。 */
export function curveRange(
  freqs: number[],
  blocks: Block[],
  fs: number,
  preampGainDb = 0,
): { min: number; max: number } {
  let mn = Infinity;
  let mx = -Infinity;
  for (const f of freqs) {
    let db = preampGainDb;
    for (const b of blocks) {
      if (!b.enabled) continue;
      for (const band of b.bands) db += bandDbCached(f, band, fs);
    }
    if (db < mn) mn = db;
    if (db > mx) mx = db;
  }
  return { min: mn === Infinity ? 0 : mn, max: mx === -Infinity ? 0 : mx };
}
