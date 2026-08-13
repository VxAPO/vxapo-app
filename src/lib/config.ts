// VxAPO App — config.txt 生成（App 引用规范 §4.3 / §六）
// 纯函数：模块列表 → EAPO 兼容 config 文本；写回前主动限幅（与 driver 规则一致）。

import { FILTER_TYPE_MAP, DEFAULT_PREAMP_DB, expandPresetFilters, presetById, clampDb } from "../data/presets";
import type { Filter, ModuleInstance } from "../types";

export interface ConfigOptions {
  preampDb?: number;
  loudnessEnabled?: boolean;
  tuningEnabled?: boolean;
}

function filterLine(f: Filter): string {
  const type = FILTER_TYPE_MAP[f.type] ?? "PK";
  const freq = Math.min(21600, Math.max(10, f.frequency));
  const q = Math.min(18, Math.max(0.05, f.q));
  return `IIR: ${type} Fc ${Math.round(freq)} Hz Gain ${clampDb(f.gain).toFixed(1)} dB Q ${q.toFixed(3)}`;
}

/** 模块列表 → 展开后的滤波器链（按模块顺序）。 */
export function expandModules(modules: ModuleInstance[]): Filter[] {
  const out: Filter[] = [];
  for (const m of modules) {
    const preset = presetById(m.presetId);
    if (!preset) continue;
    out.push(...expandPresetFilters(preset, m.intensity));
  }
  return out;
}

/** 生成写回 driver 的 config.txt 文本（含主动限幅）。 */
export function buildConfig(modules: ModuleInstance[], options: ConfigOptions = {}): string {
  const {
    preampDb = DEFAULT_PREAMP_DB,
    loudnessEnabled = true,
    tuningEnabled = true,
  } = options;

  if (!tuningEnabled) {
    return "# VxAPO passthrough（调音未启用）\n";
  }

  const lines: string[] = [];
  lines.push(`Loudness: ${loudnessEnabled ? "on" : "off"}`);
  lines.push(`Preamp: ${clampDb(preampDb).toFixed(1)} dB`);
  for (const f of expandModules(modules)) {
    lines.push(filterLine(f));
  }
  return `${lines.join("\n")}\n`;
}

/** 频率响应曲线点（用于 FreqResponseCurve，简易 RBJ 幅频）。 */
export function frequencyResponse(filters: Filter[], points = 160): { freq: number; db: number }[] {
  const out: { freq: number; db: number }[] = [];
  const sr = 48000;
  for (let i = 0; i < points; i++) {
    const freq = 20 * Math.pow(1000, i / (points - 1)); // 20Hz..20kHz
    const w0 = (2 * Math.PI * freq) / sr;
    const cos = Math.cos(w0);
    const sin = Math.sin(w0);
    let totalDb = 0;
    for (const f of filters) {
      if (!f.enabled) continue;
      const A = Math.pow(10, clampDb(f.gain) / 40);
      const alpha = sin / (2 * Math.max(0.05, f.q));
      let b0 = 1, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;
      switch (f.type) {
        case "LowShelf": {
          const sq = 2 * Math.sqrt(A) * alpha;
          b0 = A * ((A + 1) - (A - 1) * cos + sq);
          b1 = 2 * A * ((A - 1) - (A + 1) * cos);
          b2 = A * ((A + 1) - (A - 1) * cos - sq);
          a0 = (A + 1) + (A - 1) * cos + sq;
          a1 = -2 * ((A - 1) + (A + 1) * cos);
          a2 = (A + 1) + (A - 1) * cos - sq;
          break;
        }
        case "HighShelf": {
          const sq = 2 * Math.sqrt(A) * alpha;
          b0 = A * ((A + 1) + (A - 1) * cos + sq);
          b1 = -2 * A * ((A - 1) + (A + 1) * cos);
          b2 = A * ((A + 1) + (A - 1) * cos - sq);
          a0 = (A + 1) - (A - 1) * cos + sq;
          a1 = 2 * ((A - 1) - (A + 1) * cos);
          a2 = (A + 1) - (A - 1) * cos - sq;
          break;
        }
        case "LowPass":
          b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = (1 - cos) / 2;
          a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
          break;
        case "HighPass":
          b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = (1 + cos) / 2;
          a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
          break;
        case "Notch":
          b0 = 1; b1 = -2 * cos; b2 = 1;
          a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha;
          break;
        case "Peak":
        default:
          b0 = 1 + alpha * A; b1 = -2 * cos; b2 = 1 - alpha * A;
          a0 = 1 + alpha / A; a1 = -2 * cos; a2 = 1 - alpha / A;
          break;
      }
      const re = b0 + b1 * cos + b2 * Math.cos(2 * w0);
      const im = b1 * sin - b2 * Math.sin(2 * w0);
      const dre = a0 + a1 * cos + a2 * Math.cos(2 * w0);
      const dim = a1 * sin - a2 * Math.sin(2 * w0);
      const mag = Math.sqrt((re * re + im * im) / (dre * dre + dim * dim));
      totalDb += 20 * Math.log10(Math.max(1e-9, mag));
    }
    out.push({ freq, db: totalDb });
  }
  return out;
}
