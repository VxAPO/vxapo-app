import type { Block } from "./model";

export const PERCEPTUAL_RANGES: [number, number, string][] = [
  [20, 40, "极低频下潜感"],
  [40, 80, "低频冲击感"],
  [80, 160, "中低频温暖感"],
  [160, 300, "中低频浑浊感"],
  [300, 500, "中频鼻音感"],
  [500, 800, "中频坚实感"],
  [800, 1300, "中频临场感"],
  [1300, 2600, "中高频咬字感"],
  [2600, 3600, "高频齿音感"],
  [3600, 5100, "高频穿透感"],
  [5100, 8000, "极高频锐利感"],
  [8000, 12000, "极高频空气感"],
  [12000, 16000, "极高频光泽感"],
  [16000, 20000, "极高频延伸感"],
];

export function perceptualLabel(fc: number): string {
  for (const [lo, hi, label] of PERCEPTUAL_RANGES) {
    if (fc >= lo && fc < hi) return label;
  }
  return fc >= 20000 ? "极高频延伸感" : "—";
}

export function semanticName(block: Block): string {
  const n = block.name?.trim() ?? "";
  const isDefault = !n || n === "未命名" || /立体声\s*EQ/i.test(n);
  if (isDefault) {
    return block.bands[0] ? perceptualLabel(block.bands[0].fc) : n || "未命名";
  }
  return n;
}

export function nextGroupName(base: string, groups: Set<string>): string {
  if (!groups.has(base)) return base;
  let n = 2;
  while (groups.has(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

export function ensureBlockIds(blocks: Block[]): Block[] {
  return blocks.map((b) => (b.id ? b : { ...b, id: crypto.randomUUID() }));
}

/** 忽略 id 后比较两个块的内容是否一致（group/name/enabled/bands） */
export function blocksEqualShape(a: Block, b: Block): boolean {
  return (
    a.group === b.group &&
    a.name === b.name &&
    a.enabled === b.enabled &&
    a.bands.length === b.bands.length &&
    a.bands.every((band, i) => {
      const other = b.bands[i];
      return band.fc === other.fc && band.gain_db === other.gain_db && band.q === other.q;
    })
  );
}

/** 热更新/外部刷新时合并 id：内容相同的块沿用旧 id，新增块才分配新 id，保证拖拽期间 key 稳定 */
export function mergeBlockIds(prev: Block[], next: Block[]): Block[] {
  const used = new Set<string>();
  return next.map((b, i) => {
    const samePos = prev[i];
    if (samePos?.id && !used.has(samePos.id) && blocksEqualShape(samePos, b)) {
      used.add(samePos.id);
      return { ...b, id: samePos.id };
    }
    const sameAny = prev.find((p) => p.id && !used.has(p.id) && blocksEqualShape(p, b));
    if (sameAny?.id) {
      used.add(sameAny.id);
      return { ...b, id: sameAny.id };
    }
    return { ...b, id: crypto.randomUUID() };
  });
}

export function buildSemanticUnits(blocks: Block[]): { key: string; blocks: Block[] }[] {
  const units: { key: string; blocks: Block[] }[] = [];
  const emitted = new Set<string>();
  blocks.forEach((b) => {
    if (!b.group) {
      units.push({ key: `s-${b.id}`, blocks: [b] });
      return;
    }
    if (emitted.has(b.group)) return;
    emitted.add(b.group);
    units.push({ key: `g-${b.group}`, blocks: blocks.filter((x) => x.group === b.group) });
  });
  return units;
}

export type BandPatch = Partial<{ fc: number; gain_db: number; q: number }>;

export interface BlockGroup {
  label: string;
  items: { block: Block; idx: number }[];
}

export function groupBlocks(blocks: Block[]): BlockGroup[] {
  const out: BlockGroup[] = [];
  const seen = new Map<string, BlockGroup>();
  blocks.forEach((b, idx) => {
    if (!b.group) return;
    let g = seen.get(b.group);
    if (!g) {
      g = { label: b.group, items: [] };
      seen.set(b.group, g);
      out.push(g);
    }
    g.items.push({ block: b, idx });
  });
  return out;
}

export type RenderOrderItem =
  | { kind: "group"; g: BlockGroup; ord: number }
  | { kind: "standalone"; block: Block; idx: number };

export function buildRenderOrder(blocks: Block[], groups: BlockGroup[]): RenderOrderItem[] {
  const out: RenderOrderItem[] = [];
  const emitted = new Set<string>();
  blocks.forEach((b, idx) => {
    if (!b.group) {
      out.push({ kind: "standalone", block: b, idx });
      return;
    }
    if (emitted.has(b.group)) return;
    emitted.add(b.group);
    const g = groups.find((x) => x.label === b.group)!;
    out.push({ kind: "group", g, ord: idx + 1 });
  });
  return out;
}

export type SortItem =
  | { key: string; kind: "standalone"; block: Block; idx: number }
  | { key: string; kind: "group"; g: BlockGroup; ord: number };

export function buildSortItems(renderOrder: RenderOrderItem[]): SortItem[] {
  return renderOrder.map((item) =>
    item.kind === "standalone"
      ? {
          key: `s-${item.block.id ?? item.idx}`,
          kind: "standalone" as const,
          block: item.block,
          idx: item.idx,
        }
      : { key: `g-${item.g.label}`, kind: "group" as const, g: item.g, ord: item.ord },
  );
}
