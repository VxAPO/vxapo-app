// VxAPO App — config.toml 生成与解析（UI 设计规范 01 契约）
// 只负责自身生成的结构；外部 TOML 的非 peq 效果器忽略。

import type { Band, Block } from "./model";

function num(n: number): string {
  if (!Number.isFinite(n)) return "0";
  return Number(n.toFixed(4)).toString();
}

function str(s: string): string {
  return JSON.stringify(s); // TOML basic string 转义与 JSON 兼容（引号/反斜杠）
}

export function buildToml(blocks: Block[], enabled = true): string {
  const out: string[] = ["version = 1", `enabled = ${enabled}`, "", "[meta]", 'app = "vxapo"', "schema = 1", ""];
  for (const b of blocks) {
    out.push("[[effects]]", 'type = "peq"');
    if (b.group) out.push(`group = ${str(b.group)}`);
    if (b.name) out.push(`name = ${str(b.name)}`);
    out.push(`enabled = ${b.enabled}`, "crossover_hz = 200");
    for (const band of b.bands) {
      out.push("", "[[effects.bands]]", `fc = ${num(band.fc)}`, `gain_db = ${num(band.gain_db)}`, `q = ${num(band.q)}`);
    }
    out.push("");
  }
  return out.join("\n");
}

/** 解析自身生成的 config.toml（逐行状态机，只支持 peq 块）。 */
function pushBlock(blocks: Block[], b: Block) {
  if (!b.bands.length) return;
  if (b.bands.length === 1) {
    blocks.push(b);
    return;
  }
  // 一个 band 一张卡：多段 peq 块拆成多个单段块（保留 group/name/enabled）。
  for (const band of b.bands) {
    blocks.push({ group: b.group, name: b.name, enabled: b.enabled, bands: [band] });
  }
}

export function parseConfig(text: string): Block[] {
  const blocks: Block[] = [];
  let current: Block | null = null;
  const lineRe = /^\s*([A-Za-z0-9_.-]+)\s*=\s*(.+?)\s*$/;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("[[effects.bands]]")) {
      if (!current) continue;
      continue;
    }
    if (line.startsWith("[[effects]]")) {
      if (current) pushBlock(blocks, current);
      current = { enabled: true, bands: [] };
      continue;
    }
    if (!current) continue;
    const m = lineRe.exec(line);
    if (!m) continue;
    const key = m[1];
    const value = m[2];
    const unquote = (v: string) => (v.startsWith('"') ? JSON.parse(v) : v);
    switch (key) {
      case "type":
        if (unquote(value) !== "peq") current = null; // 只处理 peq 块
        break;
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
        break; // 固定 200，忽略
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
  return blocks;
}

export interface ConfigParse {
  blocks: Block[];
  /** 顶层总开关：false = 整链 passthrough（driver v9.17）。 */
  enabled: boolean;
  /** 原文件中首个非 peq 效果块起、到文件末尾的原始文本（保存时原样拼回，防止丢 wide/aural 等）。 */
  tail: string;
}

export function parseConfigWithTail(text: string): ConfigParse {
  const blocks = parseConfig(text);
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
    if (type && type !== "peq") {
      return { blocks, enabled, tail: "\n" + lines.slice(i).join("\n") };
    }
  }
  return { blocks, enabled, tail: "" };
}

export function countBands(blocks: Block[]): number {
  return blocks.reduce((acc, b) => acc + b.bands.length, 0);
}

export function cloneBand(b: Band): Band {
  return { fc: b.fc, gain_db: b.gain_db, q: b.q };
}
