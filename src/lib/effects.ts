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
      // 数值按「写盘值」比较：compressor.ratio 的 0.95~1.0 写盘都是 20:1，
      // 否则读回0.95 会把屏上拖满的 1.0 判成外部改动换掉（滑杆弹回）。
      return (
        kx.length === ky.length &&
        kx.every((k) => {
          const a = px[k];
          const b = py[k];
          if (typeof a === "number" && typeof b === "number") {
            return toDriverParam(x.type, k, a) === toDriverParam(x.type, k, b);
          }
          return a === b;
        })
      );
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
  "wide.side_itd": "侧向去相关",
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
  "compressor.ratio": "压缩比",
  "compressor.lift": "抬升",
  "compressor.attack_ms": "起音",
  "compressor.mix": "混合",
  "loudness.phon": "目标响度",
  "loudness.reference_phon": "参考响度",
};

/** UI 侧枚举选项（当前无枚举参数，保留结构以便扩展）。 */
const PARAM_OPTIONS: Record<string, { value: string; label: string }[]> = {};

/**
 * 参数值域覆盖（仅 UI 显示域 ≠ driver 值域的参数登记；决策 2 的显式例外）：
 * `compressor.ratio` —— App 内部（滑杆值、输入框显示、语义强度、内存存储）统一用
 * **0..1 增益削减斜率 `v = 1 − 1/ratio`**（3:1 → 0.67、20:1 → 0.95，到不了 1）；
 * 与 driver 的 x:1 值域只在**读/写 TOML 时各换算一次**（`fromDriverParam` / `toDriverParam`），
 * 渲染时不从 ratio 反推滑杆位置。
 */
export const UI_PARAM_RANGES: Record<string, { min: number; max: number; step: number }> = {
  "compressor.ratio": { min: 0, max: 1, step: 0.01 },
};

const RATIO_MAX = 20;

/** 读 TOML（一次性换算）：driver x:1 → 内部斜率 `v = 1 − 1/ratio`（两位小数）。 */
export function fromDriverParam(type: string, key: string, raw: number): number {
  if (type !== "compressor" || key !== "ratio") return raw;
  if (!Number.isFinite(raw)) return 0;
  return Math.round((1 - 1 / Math.max(raw, 1)) * 100) / 100;
}

/**
 * 写 TOML / `effectsEqual` 比较（一次性换算）：内部斜率 v → driver x:1，
 * `ratio = 1/(1−v)`，超过 20 一律 clamp 到 20（v = 1 时 `1/0` 是无穷，直接取 20）。
 * 0.95~1.0 这段写盘都是 20:1，往返比较因此相等——拖满的 1.0 不会读回 0.95 弹回。
 */
export function toDriverParam(type: string, key: string, v: number): number {
  if (type !== "compressor" || key !== "ratio") return v;
  const c = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
  const ratio = 1 / (1 - c);
  return ratio > RATIO_MAX ? RATIO_MAX : Math.round(ratio * 100) / 100;
}

/** 参数定义：范围/步进/单位取 driver 表（显示域例外见 `UI_PARAM_RANGES`），label 取 UI 文案表。 */
export function effectParams(type: string): EffectParamDef[] {
  const spec = EFFECT_PARAM_SPECS.find((e) => e.effect === type);
  if (!spec) return [];
  return spec.params.map((p) => {
    const id = `${type}.${p.key}`;
    const ui = UI_PARAM_RANGES[id];
    return {
      key: p.key,
      label: PARAM_LABELS[id] ?? p.key,
      min: ui?.min ?? p.min,
      max: ui?.max ?? p.max,
      step: ui?.step ?? p.step,
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
  wide: { gain: 0.05, air: 0.2, side_itd: 0.2, crossover_hz: 200 },
  aural: { tune_hz: 1760, drive: 1.7699, odd: 1.5, even: 0.25, wet: 0.5, dry: 0.5 },
  // reverb 干湿交叉淡化：wet 上限 0.9、dry=1-wet，永不过 1；
  // 默认强度 s=wet/0.9=0.3 处 decay/damping/预延迟/房间大小过当前默认值。
  reverb: { room_size: 1, decay: 0.41, damping: 0.4083, pre_delay_ms: 0, low_cut_hz: 100, wet: 0.27, dry: 0.73 },
  // compressor 无 UI 覆盖：参数模型（-12/3/0/10ms/100%）直接以 driver 默认为初值。
  loudness: { phon: 80, reference_phon: 80 },
};

/** driver 默认值按 UI 步进的位数就近取整（输入框能显示的值）。 */
function roundToStep(v: number, step: number): number {
  const decimals = (String(step).split(".")[1] ?? "").length;
  return Number(v.toFixed(decimals));
}

/** 新增效果器的参数初值：driver 默认值打底，UI 起点覆盖（均换算为内部值域）。 */
export function defaultEffectParams(type: string): Record<string, number | string> {
  const base: Record<string, number | string> = {};
  for (const p of EFFECT_PARAM_SPECS.find((e) => e.effect === type)?.params ?? []) {
    base[p.key] = fromDriverParam(type, p.key, roundToStep(p.default, p.step));
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
      // 压缩比内部即 0..1 增益削减斜率（与参数视图同一份值），直接就是强度；
      // 缺省 0.67 = driver 默认 3:1 换算（1 − 1/3）。
      return clamp01(asNum(params.ratio, 0.67));
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
      // 语义强度同时驱动「中置空气」与「侧向时间差」（0→1，无死区）；
      // 高频补偿（低频深度）由参数视图手动微调，语义滑块不碰。
      next.air = Math.round(s * 10000) / 10000;
      next.side_itd = Math.round(s * 10000) / 10000;
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
      // 强度即内部 0..1 斜率值本身（与参数视图同一份值）：拉满 = 1（写盘 20:1），
      // 拉低 = 0（写盘 1:1 不压缩）。
      next.ratio = Math.round(s * 100) / 100;
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
