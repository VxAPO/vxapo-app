import type { EffectItem } from "./model";

export interface EffectDef {
  type: string;
  name: string;
  desc: string;
  color: string;
}

/** 效果器定义与中文名 */
export const EFFECT_DEFS: EffectDef[] = [
  { type: "preamp", name: "基准电平", desc: "整链增益补偿，用于把峰值拉回 0 dB", color: "#c360bc" },
  { type: "wide", name: "声场加宽", desc: "拓宽立体声声像，空间感更强", color: "#00a3a5" },
  { type: "aural", name: "谐波激励器", desc: "谐波激励，提升细节与空气感", color: "#6082e9" },
  { type: "reverb", name: "混响", desc: "增加空间混响，声音更润", color: "#996fda" },
  { type: "maximizer", name: "自动增益", desc: "自动调整增益，保持稳定响度", color: "#e05d40" },
  { type: "loudness", name: "等响补偿", desc: "等响度曲线补偿，小音量更平衡", color: "#519741" },
];

export const KNOWN_EFFECT_TYPES = EFFECT_DEFS.map((e) => e.type);

export function effectDef(type: string): EffectDef | undefined {
  return EFFECT_DEFS.find((e) => e.type === type);
}

export function effectsEqual(a: EffectItem[], b: EffectItem[]): boolean {
  return (
    a.length === b.length &&
    a.every((x, i) => {
      const y = b[i];
      if (!y || x.type !== y.type || x.enabled !== y.enabled) return false;
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
  wide: [{ key: "intensity", label: "强度", min: 0, max: 1, step: 0.01 }],
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
  wide: { intensity: 0.3543 },
  aural: { tune_hz: 1760, drive: 1.7699, odd: 1.5, even: 0, wet: 1, dry: 0 },
  reverb: { room_size: 1, decay: 0.5657, damping: 0.4083, pre_delay_ms: 0, wet: 0.3, dry: 0.9 },
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
      return clamp01(asNum(params.wet, 1));
    case "reverb":
      return clamp01(asNum(params.wet, 0.3));
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
      break;
    case "aural":
    case "reverb":
      next.wet = Math.round(s * 10000) / 10000;
      break;
    case "maximizer":
      next.gain_boost_db = Math.round(s * 3000) / 100;
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
