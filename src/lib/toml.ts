// VxAPO App —— config.toml 生成与解析（UI 设计规范 01 契约）
// 只负责自身生成的结构；外部 TOML 的非 peq 未知效果器保留为 tail。
import type { Band, Block, EffectItem } from "./model";
import { parse as parseToml } from "smol-toml";
import { EFFECT_PARAM_SPECS } from "./effects.generated";
import { KNOWN_EFFECT_TYPES, defaultEffectParams } from "./effects";

function num(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return Number(n.toFixed(4)).toString();
}

function str(s: unknown): string {
  return JSON.stringify(s);
}

export interface ChannelCtx {
  /** 通道模式是否开启 */
  mode: boolean;
  /** 第一声道短名 */
  first: string;
  /** 当前激活声道短名（新增块归属） */
  active: string;
}

export function buildToml(
  blocks: Block[],
  enabled = true,
  effects: EffectItem[] = [],
  channel?: ChannelCtx,
): string {
  // `version` / `[meta]` 与 peq 块的 `crossover_hz` 不属效果器参数，故仍写死：
  // driver 的 effect_param_specs() 只覆盖 [[effects]] 的可调参数（决策 2 的范围）。
  const out: string[] = ["version = 1", `enabled = ${enabled}`, "", "[meta]", 'app = "vxapo"', "schema = 1", ""];
  const writeBlocks = channel?.mode
    ? blocks
    : blocks.filter((b) => !b.channel || b.channel === channel?.first);
  for (const b of writeBlocks) {
    out.push("[[effects]]", 'type = "peq"');
    if (b.group) out.push(`group = ${str(b.group)}`);
    if (b.name) out.push(`name = ${str(b.name)}`);
    out.push(`enabled = ${b.enabled}`, "crossover_hz = 200");
    if (channel?.mode) out.push(`channels = ${str([b.channel ?? channel.first])}`);
    for (const band of b.bands) {
      out.push("", "[[effects.bands]]");
      if (band.kind && band.kind !== "peaking") out.push(`type = ${str(band.kind)}`);
      out.push(`fc = ${num(band.fc)}`, `gain_db = ${num(band.gain_db)}`, `q = ${num(band.q)}`);
    }
    out.push("");
  }
  for (const e of effects) {
    out.push("[[effects]]", `type = ${str(e.type)}`, `enabled = ${e.enabled}`);
    if (e.channels?.length) out.push(`channels = ${JSON.stringify(e.channels)}`);
    for (const [k, v] of Object.entries({ ...defaultEffectParams(e.type), ...(e.params ?? {}) })) {
      out.push(typeof v === "number" ? `${k} = ${num(v)}` : `${k} = ${str(String(v))}`);
    }
    out.push("");
  }
  return out.join("\n");
}

function pushBlock(blocks: Block[], b: Block) {
  if (!b.bands.length) return;
  if (b.bands.length === 1) {
    blocks.push(b);
    return;
  }
  for (const band of b.bands) {
    blocks.push({ group: b.group, name: b.name, channel: b.channel, enabled: b.enabled, bands: [band] });
  }
}

export interface ConfigParse {
  blocks: Block[];
  effects: EffectItem[];
  /** 通道选择器模式：存在单声道块/效果器即为开启（立体声块 channels=["L","R"] 不算）。 */
  channelMode: boolean;
  /** 顶层总开关：false = 整链 passthrough */
  enabled: boolean;
  /** 首个未知非 peq 效果器块起、到文件末尾的原始文本（保存时原样拼回，避免破坏第三方效果器） */
  tail: string;
}
/** TOML 表（smol-toml 解析结果的形态）。 */
type TomlTable = Record<string, unknown>;

/** 通道选择器：数组 → 字符串数组（非数组返回 undefined）。 */
function readChannels(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v.map((c) => String(c));
}

/** 单个 `[[effects.bands]]` 表 → Band（缺省 fc=0 / gain_db=0 / q=1）。 */
function toBand(t: TomlTable): Band {
  const kinds: Band["kind"][] = ["peaking", "low_shelf", "high_shelf", "low_pass", "high_pass"];
  const kind =
    typeof t.type === "string" && kinds.includes(t.type as Band["kind"])
      ? (t.type as Band["kind"])
      : undefined;
  return {
    fc: typeof t.fc === "number" ? t.fc : 0,
    gain_db: typeof t.gain_db === "number" ? t.gain_db : 0,
    q: typeof t.q === "number" ? t.q : 1,
    ...(kind ? { kind } : {}),
  };
}

/** 第 n 个 `[[effects]]` 块起、到文件末尾的原文（保存时原样拼回，避免破坏第三方效果器）。 */
function tailFromNthEffectsBlock(text: string, n: number): string {
  const lines = text.split(/\r?\n/);
  let seen = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== "[[effects]]") continue;
    if (seen === n) return "\n" + lines.slice(i).join("\n");
    seen++;
  }
  return "";
}

/** 参数是否落在 driver 参数表声明的范围内（仅告警，不改写用户值）。 */
function warnOutOfRange(type: string, key: string, v: number): void {
  const spec = EFFECT_PARAM_SPECS.find((e) => e.effect === type)?.params.find((p) => p.key === key);
  if (!spec) return;
  if (v < spec.min || v > spec.max) {
    console.warn(`[toml] ${type}.${key} = ${v} 超出 driver 范围 [${spec.min}, ${spec.max}]`);
  }
}

/**
 * 解析 config.toml（smol-toml）→ UI 模型。
 *
 * 与手写行解析器的差异：畸形 TOML 不再被静默吞掉半张表——解析失败时放弃解析并把
 * 原文放进 `tail`（保存时原样写回，不破坏用户文件），错误打到控制台。
 */
function parseDocument(text: string): ConfigParse {
  let doc: TomlTable;
  try {
    doc = parseToml(text) as TomlTable;
  } catch (e) {
    console.error("[toml] 解析失败：已放弃解析并按原样保留（保存时写回原文）", e);
    return { blocks: [], effects: [], channelMode: false, enabled: true, tail: text ? "\n" + text : "" };
  }
  const tables = Array.isArray(doc.effects) ? (doc.effects as TomlTable[]) : [];
  const blocks: Block[] = [];
  const effects: EffectItem[] = [];
  // 通道选择器模式：任意块/效果器带“单声道 channels”即视为开启；
  // 多元素（如 ["L","R"]）是立体声共用一个块，不属通道模式。
  let channelMode = false;
  let tail = "";

  for (let i = 0; i < tables.length; i++) {
    const t = tables[i];
    const type = typeof t.type === "string" ? t.type : "";
    const channels = readChannels(t.channels);
    if (channels?.length === 1) channelMode = true;

    if (type === "peq") {
      const bands = Array.isArray(t.bands) ? (t.bands as TomlTable[]).map(toBand) : [];
      const block: Block = {
        enabled: t.enabled !== false,
        bands,
        ...(typeof t.group === "string" ? { group: t.group } : {}),
        ...(typeof t.name === "string" ? { name: t.name } : {}),
        ...(channels?.length ? { channel: channels[0] } : {}),
      };
      // 多 band 的 peq 块按 band 拆成多个块（与手写解析器一致）。
      pushBlock(blocks, block);
      continue;
    }
    if (KNOWN_EFFECT_TYPES.includes(type)) {
      const params: Record<string, number | string> = {};
      for (const [k, v] of Object.entries(t)) {
        if (k === "type" || k === "enabled" || k === "channels" || k === "bands") continue;
        if (typeof v === "number") {
          warnOutOfRange(type, k, v);
          params[k] = v;
        } else if (typeof v === "string") {
          params[k] = v;
        }
      }
      effects.push({
        type,
        enabled: t.enabled !== false,
        ...(channels?.length ? { channels } : {}),
        ...(Object.keys(params).length ? { params } : {}),
      });
      continue;
    }
    // 未知非 peq 效果器：自该块起原文保留（不解析、保存时原样写回）。
    tail = tailFromNthEffectsBlock(text, i);
    break;
  }

  return {
    blocks,
    effects,
    channelMode,
    enabled: typeof doc.enabled === "boolean" ? doc.enabled : true,
    tail,
  };
}

export function parseConfig(text: string): {
  blocks: Block[];
  effects: EffectItem[];
  channelMode: boolean;
} {
  const { blocks, effects, channelMode } = parseDocument(text);
  return { blocks, effects, channelMode };
}

export function parseConfigWithTail(text: string): ConfigParse {
  return parseDocument(text);
}

export function countBands(blocks: Block[]): number {
  return blocks.reduce((acc, b) => acc + b.bands.length, 0);
}

export function cloneBand(b: Band): Band {
  return { fc: b.fc, gain_db: b.gain_db, q: b.q, ...(b.kind ? { kind: b.kind } : {}) };
}
