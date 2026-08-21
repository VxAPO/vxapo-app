import type { EffectItem } from "./model";

export interface EffectDef {
  type: string;
  name: string;
  desc: string;
  color: string;
}

/** 效果器定义与中文名 */
export const EFFECT_DEFS: EffectDef[] = [
  { type: "preamp", name: "effect.preamp", desc: "effect.preamp.desc", color: "#c360bc" },
  { type: "wide", name: "effect.wide", desc: "effect.wide.desc", color: "#00a3a5" },
  { type: "aural", name: "effect.aural", desc: "effect.aural.desc", color: "#6082e9" },
  { type: "reverb", name: "effect.reverb", desc: "effect.reverb.desc", color: "#996fda" },
  { type: "maximizer", name: "effect.maximizer", desc: "effect.maximizer.desc", color: "#e05d40" },
  { type: "loudness", name: "effect.loudness", desc: "effect.loudness.desc", color: "#519741" },
];

export const KNOWN_EFFECT_TYPES = EFFECT_DEFS.map((e) => e.type);

export function effectDef(type: string): EffectDef | undefined {
  return EFFECT_DEFS.find((e) => e.type === type);
}

export function effectsEqual(a: EffectItem[], b: EffectItem[]): boolean {
  const ch = (x: EffectItem) => (x.channels?.length ? [...x.channels].sort().join(",") : "");
  return (
    a.length === b.length &&
    a.every((x, i) => {
      const y = b[i];
      if (!y || x.type !== y.type || x.enabled !== y.enabled || ch(x) !== ch(y)) return false;
      const px = x.params ?? {};
      const py = y.params ?? {};
      const kx = Object.keys(px);
      const ky = Object.keys(py);
      return kx.length === ky.length && kx.every((k) => px[k] === py[k]);
    })
  );
}

export interface EffectParamDef {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  unit?: string;
  options?: { value: string; label: string }[];
}

const EFFECT_PARAMS: Record<string, EffectParamDef[]> = {
  preamp: [{ key: "gain_db", label: "增益", min: -120, max: 48, step: 0.1, unit: "dB" }],
  wide: [
    { key: "intensity", label: "强度", min: 0, max: 1, step: 0.01 },
    { key: "depth", label: "深度", min: 0, max: 1, step: 0.01 },
    { key: "crossover_hz", label: "分频点", min: 100, max: 1000, step: 10, unit: "Hz" },
  ],
  aural: [
    { key: "tune_hz", label: "中心频率", min: 500, max: 10000, step: 10, unit: "Hz" },
    { key: "drive", label: "驱动", min: 0, max: 4.25, step: 0.01 },
    { key: "odd", label: "奇次谐波", min: 0, max: 1.5, step: 0.01 },
    { key: "even", label: "偶次谐波", min: 0, max: 0.75, step: 0.01 },
    { key: "wet", label: "湿声", min: 0, max: 1, step: 0.01 },
    { key: "dry", label: "干声", min: 0, max: 1, step: 0.01 },
  ],
  reverb: [
    { key: "room_size", label: "房间大小", min: 0.5, max: 1.5, step: 0.01 },
    { key: "decay", label: "衰减", min: 0, max: 1, step: 0.01 },
    { key: "damping", label: "阻尼", min: 0, max: 1, step: 0.01 },
    { key: "pre_delay_ms", label: "预延迟", min: 0, max: 100, step: 1, unit: "ms" },
    { key: "wet", label: "湿声", min: 0, max: 1, step: 0.01 },
    { key: "dry", label: "干声", min: 0, max: 1, step: 0.01 },
  ],
  maximizer: [
    { key: "gain_boost_db", label: "增益提升", min: 0, max: 30, step: 0.1, unit: "dB" },
    { key: "max_output_db", label: "输出上限", min: -30, max: 0, step: 0.1, unit: "dB" },
    { key: "release_ms", label: "释放时间", min: 0.1, max: 100, step: 0.1, unit: "ms" },
    { key: "target", label: "目标电平", min: 0.01, max: 1, step: 0.01 },
    { key: "lookahead_ms", label: "预看", min: 0, max: 10, step: 0.1, unit: "ms" },
    {
      key: "dither",
      label: "抖动",
      min: 0,
      max: 1,
      step: 1,
      options: [
        { value: "none", label: "无" },
        { value: "uniform", label: "均匀" },
        { value: "triangular", label: "三角" },
        { value: "shaped", label: "整形" },
      ],
    },
  ],
  loudness: [
    { key: "phon", label: "目标响度", min: 0, max: 120, step: 1, unit: "phon" },
    { key: "reference_phon", label: "参考响度", min: 0, max: 120, step: 1, unit: "phon" },
  ],
};

const DEFAULT_EFFECT_PARAMS: Record<string, Record<string, number | string>> = {
  preamp: { gain_db: 0 },
  wide: { intensity: 0.3543, depth: 0, crossover_hz: 200 },
  aural: { tune_hz: 1760, drive: 1.7699, odd: 1.5, even: 0.25, wet: 0.5, dry: 0.5 },
  // 干湿交叉淡化：wet 上限 0.9、dry=1-wet，永不过 1；
  // 默认强度 s=wet/0.9=0.3 处 decay/damping/预延迟/房间大小过当前默认值。
  reverb: { room_size: 1, decay: 0.41, damping: 0.4083, pre_delay_ms: 0, wet: 0.27, dry: 0.73 },
  maximizer: {
    gain_boost_db: 6,
    max_output_db: -0.3,
    release_ms: 10.18,
    target: 0.32,
    lookahead_ms: 0.75,
    dither: "shaped",
  },
  loudness: { phon: 80, reference_phon: 80 },
};

export function effectParams(type: string): EffectParamDef[] {
  return EFFECT_PARAMS[type] ?? [];
}

export function defaultEffectParams(type: string): Record<string, number | string> {
  return { ...(DEFAULT_EFFECT_PARAMS[type] ?? {}) };
}

function asNum(v: number | string | undefined, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** 语义强度（0..1）：把效果器核心参数换算成感知量，参数视图里的细调会同步反映 */
export function semanticStrength(type: string, params: Record<string, number | string>): number {
  switch (type) {
    case "wide":
      return clamp01(asNum(params.intensity, 0.3543));
    case "aural":
      return clamp01(asNum(params.wet, 0.5) / 0.9);
    case "reverb":
      return clamp01(asNum(params.wet, 0.27) / 0.9);
    case "maximizer":
      return clamp01(asNum(params.gain_boost_db, 6) / 30);
    case "loudness": {
      const ref = asNum(params.reference_phon, 80);
      return clamp01((ref - asNum(params.phon, ref)) / 40);
    }
    case "preamp":
      return clamp01((asNum(params.gain_db, 0) + 24) / 48);
    default:
      return 1;
  }
}

/** 把语义强度（0..1）写回对应的核心参数，与参数视图共用同一份数据 */
export function applySemanticStrength(
  type: string,
  strength: number,
  params: Record<string, number | string>,
): Record<string, number | string> {
  const next = { ...params };
  const s = clamp01(strength);
  switch (type) {
    case "wide":
      next.intensity = Math.round(s * 10000) / 10000;
      // 拉高强度顺带加深中心距离：默认强度处 depth=0 保持原声。
      next.depth = Math.round(Math.max(0, Math.min(0.7, s - 0.3)) * 10000) / 10000;
      break;
    case "aural": {
      // 干湿交叉淡化：wet 上限 0.9、dry=1-wet，避免干湿和 >1 削波。
      const wet = Math.round(s * 0.9 * 10000) / 10000;
      next.wet = wet;
      next.dry = Math.round((1 - wet) * 10000) / 10000;
      break;
    }
    case "reverb": {
      // 强度 = 湿声 + 尾长 + 预延迟 + 房间大小联动，阻尼随衰减一起升；
      // 干湿交叉淡化保证和 ≤ 1。
      const wet = Math.round(s * 0.9 * 10000) / 10000;
      next.wet = wet;
      next.dry = Math.round((1 - wet) * 10000) / 10000;
      next.decay = Math.round((0.2 + 0.7 * s) * 10000) / 10000;
      next.damping =
        Math.round((0.15 + 0.63 * (0.2 + 0.7 * s)) * 10000) / 10000;
      next.pre_delay_ms = Math.round(Math.max(0, Math.min(0.7, s - 0.3)) * 50 * 10) / 10;
      next.room_size = Math.round((0.85 + 0.5 * s) * 10000) / 10000;
      break;
    }
    case "maximizer":
      next.gain_boost_db = Math.round(s * 3000) / 100;
      // 强度提升时释放时间与预看相应增加（默认强度 0.2 处过原默认值）。
      next.release_ms = Math.round((4 + 30.9 * s) * 100) / 100;
      next.lookahead_ms = Math.round((0.5 + 1.25 * s) * 100) / 100;
      break;
    case "loudness": {
      const ref = asNum(params.reference_phon, 80);
      next.phon = Math.round((ref - s * 40) * 100) / 100;
      break;
    }
    case "preamp":
      next.gain_db = Math.round((s * 48 - 24) * 10) / 10;
      break;
  }
  return next;
}
