import type { EffectItem } from "./model";
import { EFFECT_PARAM_SPECS } from "./effects.generated";

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
  { type: "compressor", name: "effect.compressor", desc: "effect.compressor.desc", color: "#e05d40" },
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

/**
 * 参数文案（UI 专属）。范围/步进/单位来自 driver 参数表（effects.generated.ts，决策 2），
 * 此处只维护 label；键为 `{effect}.{param}`，缺省回落到参数键本身。
 */
const PARAM_LABELS: Record<string, string> = {
  "preamp.gain_db": "增益",
  "wide.gain": "高频补偿",
  "wide.air": "中置空气",
  "wide.air_side": "侧向空气",
  "wide.mix": "干湿混合",
  "wide.crossover_hz": "分频点",
  "aural.tune_hz": "中心频率",
  "aural.drive": "驱动",
  "aural.odd": "奇次谐波",
  "aural.even": "偶次谐波",
  "aural.wet": "湿声",
  "aural.dry": "干声",
  "reverb.room_size": "房间大小",
  "reverb.decay": "衰减",
  "reverb.damping": "阻尼",
  "reverb.pre_delay_ms": "预延迟",
  "reverb.low_cut_hz": "低频保护",
  "reverb.wet": "湿声",
  "reverb.dry": "干声",
  "compressor.threshold_db": "阈值",
  "compressor.ratio": "比例",
  "compressor.knee_db": "软膝",
  "compressor.attack_ms": "攻击",
  "compressor.release_ms": "释放时间",
  "compressor.makeup_gain_db": "补偿增益",
  "compressor.wet": "湿声",
  "compressor.dry": "干声",
  "loudness.phon": "目标响度",
  "loudness.reference_phon": "参考响度",
};

/** UI 侧枚举选项（当前无枚举参数，保留结构以便扩展）。 */
const PARAM_OPTIONS: Record<string, { value: string; label: string }[]> = {};

/** 参数定义：范围/步进/单位取 driver 表，label 取 UI 文案表。 */
export function effectParams(type: string): EffectParamDef[] {
  const spec = EFFECT_PARAM_SPECS.find((e) => e.effect === type);
  if (!spec) return [];
  return spec.params.map((p) => {
    const id = `${type}.${p.key}`;
    return {
      key: p.key,
      label: PARAM_LABELS[id] ?? p.key,
      min: p.min,
      max: p.max,
      step: p.step,
      unit: p.unit,
      options: PARAM_OPTIONS[id],
    };
  });
}

/**
 * UI 起点（新增效果器时写入的初值）——**app 自有取舍，不跟随 driver 默认值**：
 * - 输入框放不下长浮点、正常使用也不需要那种精度，故有意取更短的小数
 *   （如 air 0.3543、drive 1.7699；driver 的精确默认值见 effects.generated.ts）；
 * - 个别参数有意偏置以获得更好的初始听感（如 wide.gain 0.05，driver 默认 0）。
 * 未列出的参数回落到 driver 默认值（按步进位数就近取整）。
 */
const UI_DEFAULT_PARAMS: Record<string, Record<string, number>> = {
  preamp: { gain_db: 0 },
  wide: { gain: 0.05, air: 0.3543, air_side: 0, mix: 0.6, crossover_hz: 200 },
  aural: { tune_hz: 1760, drive: 1.7699, odd: 1.5, even: 0.25, wet: 0.5, dry: 0.5 },
  // reverb 干湿交叉淡化：wet 上限 0.9、dry=1-wet，永不过 1；
  // 默认强度 s=wet/0.9=0.3 处 decay/damping/预延迟/房间大小过当前默认值。
  reverb: { room_size: 1, decay: 0.41, damping: 0.4083, pre_delay_ms: 0, low_cut_hz: 100, wet: 0.27, dry: 0.73 },
  compressor: {
    threshold_db: -18,
    ratio: 4,
    knee_db: 3,
    attack_ms: 10,
    release_ms: 100,
    makeup_gain_db: 6,
    wet: 1,
    dry: 0,
  },
  loudness: { phon: 80, reference_phon: 80 },
};

/** driver 默认值按 UI 步进的位数就近取整（输入框能显示的值）。 */
function roundToStep(v: number, step: number): number {
  const decimals = (String(step).split(".")[1] ?? "").length;
  return Number(v.toFixed(decimals));
}

/** 新增效果器的参数初值：driver 默认值打底，UI 起点覆盖。 */
export function defaultEffectParams(type: string): Record<string, number | string> {
  const base: Record<string, number | string> = {};
  for (const p of EFFECT_PARAM_SPECS.find((e) => e.effect === type)?.params ?? []) {
    base[p.key] = roundToStep(p.default, p.step);
  }
  return { ...base, ...(UI_DEFAULT_PARAMS[type] ?? {}) };
}

function asNum(v: number | string | undefined, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** 语义强度（0..1）：把效果器核心参数换算成感知量，参数视图里的细调会同步反映 */
export function semanticStrength(type: string, params: Record<string, number | string>): number {
  switch (type) {
    case "wide":
      // 中置距离 = 空气吸收深度（唯一距离控制）。
      return clamp01(asNum(params.air, 0.3543));
    case "aural":
      return clamp01(asNum(params.wet, 0.5) / 0.9);
    case "reverb":
      return clamp01(asNum(params.wet, 0.27) / 0.9);
    case "compressor":
      // 强度 = 压缩比（1 → 0，20 → 1）。
      return clamp01((asNum(params.ratio, 4) - 1) / 19);
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
      // 语义强度即空气吸收深度（0→1，无死区）；
      // 高频补偿由参数视图手动微调，语义滑块不碰。
      next.air = Math.round(s * 10000) / 10000;
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
    case "compressor":
      // 强度拉满 → 20:1，拉低 → 1:1（不压缩）。
      next.ratio = Math.round((1 + s * 19) * 100) / 100;
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
