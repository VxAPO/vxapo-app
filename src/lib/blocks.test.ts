// blocks.ts 测试（任务 12 后续）：标签推导、稳定 id、内容比较与分组/排序工具。
import { describe, expect, it } from "vitest";
import {
  blocksEqualShape,
  buildRenderOrder,
  buildSemanticUnits,
  buildSortItems,
  ensureBlockIds,
  groupBlocks,
  mergeBlockIds,
  nextGroupName,
  perceptualLabel,
  semanticName,
} from "./blocks";
import type { Band, Block } from "./model";

function band(over: Partial<Band> = {}): Band {
  return { fc: 1000, gain_db: 0, q: 1, ...over };
}

function blk(over: Partial<Block> = {}): Block {
  return { enabled: true, bands: [band()], ...over };
}

describe("perceptualLabel", () => {
  it("按区间给出感知名（左闭右开）", () => {
    expect(perceptualLabel(20)).toBe("极低频下潜感");
    expect(perceptualLabel(39.9)).toBe("极低频下潜感");
    expect(perceptualLabel(40)).toBe("低频冲击感");
    expect(perceptualLabel(1000)).toBe("中频临场感");
    expect(perceptualLabel(15999)).toBe("极高频光泽感");
    expect(perceptualLabel(16000)).toBe("极高频延伸感");
  });

  it("≥20k 归入最高频段，<20 给占位符", () => {
    expect(perceptualLabel(20000)).toBe("极高频延伸感");
    expect(perceptualLabel(10)).toBe("—");
  });
});

describe("semanticName", () => {
  it("自定义名字保留", () => {
    expect(semanticName(blk({ name: "我的低音" }))).toBe("我的低音");
  });

  it("缺省名 / 未命名 / 旧版「立体声 EQ」回退到首段感知名", () => {
    expect(semanticName(blk({ bands: [band({ fc: 1000 })] }))).toBe("中频临场感");
    expect(semanticName(blk({ name: "未命名", bands: [band({ fc: 1000 })] }))).toBe("中频临场感");
    expect(semanticName(blk({ name: "立体声 EQ 2", bands: [band({ fc: 5000 })] }))).toBe(
      "高频穿透感",
    );
  });

  it("没有频段也没有名字时回退「未命名」", () => {
    expect(semanticName(blk({ bands: [] }))).toBe("未命名");
  });
});

describe("nextGroupName", () => {
  it("无冲突用原名，冲突递增编号", () => {
    expect(nextGroupName("低音", new Set())).toBe("低音");
    expect(nextGroupName("低音", new Set(["低音"]))).toBe("低音 2");
    expect(nextGroupName("低音", new Set(["低音", "低音 2"]))).toBe("低音 3");
  });
});

describe("ensureBlockIds", () => {
  it("只给缺失 id 的块补 id，已有的保持不变", () => {
    const out = ensureBlockIds([blk({ id: "x" }), blk({})]);
    expect(out[0].id).toBe("x");
    expect(typeof out[1].id).toBe("string");
    expect(out[1].id).not.toBe("");
  });
});

describe("blocksEqualShape", () => {
  it("忽略 id，比较内容", () => {
    expect(blocksEqualShape(blk({ id: "a" }), blk({ id: "b" }))).toBe(true);
    expect(blocksEqualShape(blk(), blk({ enabled: false }))).toBe(false);
    expect(blocksEqualShape(blk({ bands: [band({ gain_db: 3 })] }), blk())).toBe(false);
  });

  it("传入 first 时「未分配声道」与「第一声道」等价", () => {
    expect(blocksEqualShape(blk({ channel: undefined }), blk({ channel: "L" }), "L")).toBe(true);
    expect(blocksEqualShape(blk({ channel: "R" }), blk({ channel: "L" }), "L")).toBe(false);
  });
});

describe("mergeBlockIds", () => {
  it("同位同内容沿用旧 id", () => {
    const prev = [blk({ id: "keep" })];
    const out = mergeBlockIds(prev, [blk()]);
    expect(out[0].id).toBe("keep");
  });

  it("内容变化时不复用旧 id（换新 id）", () => {
    const prev = [blk({ id: "old", bands: [band({ gain_db: 3 })] })];
    const out = mergeBlockIds(prev, [blk({ bands: [band({ gain_db: 9 })] })]);
    expect(out[0].id).not.toBe("old");
    expect(out[0].id).not.toBe("");
  });

  it("顺序变化时按内容匹配旧 id", () => {
    const prev = [
      blk({ id: "a", bands: [band({ fc: 100 })] }),
      blk({ id: "b", bands: [band({ fc: 200 })] }),
    ];
    const out = mergeBlockIds(prev, [
      blk({ bands: [band({ fc: 200 })] }),
      blk({ bands: [band({ fc: 100 })] }),
    ]);
    expect(out.map((b) => b.id)).toEqual(["b", "a"]);
  });

  it("多个同形块不会共用同一个旧 id", () => {
    const prev = [blk({ id: "only" })];
    const out = mergeBlockIds(prev, [blk(), blk()]);
    expect(out[0].id).toBe("only");
    expect(out[1].id).not.toBe("only");
  });
});

describe("分组与渲染顺序", () => {
  const blocks = [
    blk({ id: "s1" }),
    blk({ id: "g1", group: "G" }),
    blk({ id: "g2", group: "G" }),
    blk({ id: "s2" }),
  ];

  it("groupBlocks 按首次出现顺序聚组，忽略无组块", () => {
    const groups = groupBlocks(blocks);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe("G");
    expect(groups[0].items.map((it) => it.idx)).toEqual([1, 2]);
  });

  it("buildRenderOrder：一组只出现一次（带首个块的序号），独立块按原序", () => {
    const order = buildRenderOrder(blocks, groupBlocks(blocks));
    expect(order.map((o) => o.kind)).toEqual(["standalone", "group", "standalone"]);
    const group = order[1];
    expect(group.kind === "group" && group.ord).toBe(2);
  });

  it("buildSortItems 生成 s-/g- 前缀键", () => {
    const items = buildSortItems(buildRenderOrder(blocks, groupBlocks(blocks)));
    expect(items.map((i) => i.key)).toEqual(["s-s1", "g-G", "s-s2"]);
  });

  it("buildSemanticUnits：无组块各自成单元，同组块合并为一个单元", () => {
    const units = buildSemanticUnits(blocks);
    expect(units.map((u) => u.key)).toEqual(["s-s1", "g-G", "s-s2"]);
    expect(units[1].blocks.map((b) => b.id)).toEqual(["g1", "g2"]);
  });
});
