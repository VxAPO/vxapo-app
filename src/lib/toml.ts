// VxAPO App —— config.toml 生成与解析（UI 设计规范 01 契约）
// 只负责自身生成的结构；外部 TOML 的非 peq 未知效果器保留为 tail。
import type { Band, Block, EffectItem } from "./model";
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
      out.push("", "[[effects.bands]]", `fc = ${num(band.fc)}`, `gain_db = ${num(band.gain_db)}`, `q = ${num(band.q)}`);
    }
    out.push("");
  }
  for (const e of effects) {
    out.push("[[effects]]", `type = ${str(e.type)}`, `enabled = ${e.enabled}`);
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

export function parseConfig(text: string): { blocks: Block[]; effects: EffectItem[] } {
  const blocks: Block[] = [];
  const effects: EffectItem[] = [];
  let current: Block | null = null;
  let currentEffect: EffectItem | null = null;
  const lineRe = /^\s*([A-Za-z0-9_.-]+)\s*=\s*(.+?)\s*$/;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("[[effects.bands]]")) {
      if (!current) continue;
      continue;
    }
    if (line.startsWith("[[effects]]")) {
      if (current) pushBlock(blocks, current);
      if (currentEffect) effects.push(currentEffect);
      current = { enabled: true, bands: [] };
      currentEffect = null;
      continue;
    }
    const m = lineRe.exec(line);
    if (!m) continue;
    const key = m[1];
    const value = m[2];
    const unquote = (v: string) => (v.startsWith('"') ? JSON.parse(v) : v);
    if (key === "type") {
      const t = unquote(value);
      if (t !== "peq") {
        current = null;
        if (KNOWN_EFFECT_TYPES.includes(t)) currentEffect = { type: t, enabled: true };
      }
      continue;
    }
    if (currentEffect) {
      if (key === "enabled") {
        currentEffect.enabled = value === "true";
      } else if (key !== "type" && key !== "channels") {
        const n = Number(value);
        (currentEffect.params ??= {})[key] = Number.isFinite(n) ? n : unquote(value);
      }
      continue;
    }
    if (!current) continue;
    switch (key) {
      case "group":
        current.group = unquote(value);
        break;
      case "name":
        current.name = unquote(value);
        break;
      case "enabled":
        current.enabled = value === "true";
        break;
      case "crossover_hz":
        break;
      case "channels": {
        try {
          const arr = JSON.parse(value) as unknown;
          if (Array.isArray(arr) && arr.length) current.channel = String(arr[0]);
        } catch {
          /* 忽略无法解析的 channels */
        }
        break;
      }
      case "fc":
        current.bands.push({ fc: Number(value), gain_db: 0, q: 1 });
        break;
      case "gain_db":
        if (current.bands.length) current.bands[current.bands.length - 1].gain_db = Number(value);
        break;
      case "q":
        if (current.bands.length) current.bands[current.bands.length - 1].q = Number(value);
        break;
      default:
        break;
    }
  }
  if (current) pushBlock(blocks, current);
  if (currentEffect) effects.push(currentEffect);
  return { blocks, effects };
}

export interface ConfigParse {
  blocks: Block[];
  effects: EffectItem[];
  /** 顶层总开关：false = 整链 passthrough（driver v9.17） */
  enabled: boolean;
  /** 首个未知非 peq 效果器块起、到文件末尾的原始文本（保存时原样拼回，避免破坏第三方效果器） */
  tail: string;
}

export function parseConfigWithTail(text: string): ConfigParse {
  const { blocks, effects } = parseConfig(text);
  const lines = text.split(/\r?\n/);
  let enabled = true;
  for (const line of lines) {
    if (line.trim().startsWith("[[effects]]")) break;
    const m = /^\s*enabled\s*=\s*(true|false)\s*$/.exec(line);
    if (m) {
      enabled = m[1] === "true";
      break;
    }
  }
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== "[[effects]]") continue;
    let type = "";
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j].trim();
      if (l.startsWith("[[effects")) break;
      const m = /^type\s*=\s*"([^"]+)"/.exec(l);
      if (m) {
        type = m[1];
        break;
      }
    }
    if (type && type !== "peq" && !KNOWN_EFFECT_TYPES.includes(type)) {
      return { blocks, effects, enabled, tail: "\n" + lines.slice(i).join("\n") };
    }
  }
  return { blocks, effects, enabled, tail: "" };
}

export function countBands(blocks: Block[]): number {
  return blocks.reduce((acc, b) => acc + b.bands.length, 0);
}

export function cloneBand(b: Band): Band {
  return { fc: b.fc, gain_db: b.gain_db, q: b.q };
}
