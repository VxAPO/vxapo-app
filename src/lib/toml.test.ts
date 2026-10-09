// config.toml 生成/解析往返（A4 首批；同时锁定决策 3 的行为）
import { describe, expect, it, vi } from "vitest";
import type { Block, EffectItem } from "./model";
import { buildToml, parseConfig, parseConfigWithTail } from "./toml";

const blocks: Block[] = [
  { id: "b1", enabled: true, bands: [{ fc: 100, gain_db: 3, q: 1.2, kind: "low_shelf" }] },
  { id: "b2", enabled: false, bands: [{ fc: 8000, gain_db: -2, q: 0.7, kind: "high_shelf" }] },
];
const effects: EffectItem[] = [
  { id: "wide:all", type: "wide", enabled: true, params: { side_itd: 0.55 } },
];

describe("buildToml ↔ parseConfigWithTail", () => {
  it("生成的 TOML 能解析回等价结构", () => {
    const parsed = parseConfigWithTail(buildToml(blocks, true, effects));
    expect(parsed.enabled).toBe(true);
    expect(parsed.blocks).toHaveLength(2);
    expect(parsed.blocks[0].bands[0]).toMatchObject({
      fc: 100,
      gain_db: 3,
      q: 1.2,
      kind: "low_shelf",
    });
    expect(parsed.blocks[1].enabled).toBe(false);
    expect(parsed.blocks[1].bands[0].kind).toBe("high_shelf");
    expect(parsed.effects[0]).toMatchObject({ type: "wide", enabled: true });
    expect(parsed.effects[0].params?.side_itd).toBe(0.55);
    expect(parsed.tail).toBe("");
  });

  it("顶层 enabled=false 可往返（整链 passthrough）", () => {
    const parsed = parseConfigWithTail(buildToml(blocks, false, effects));
    expect(parsed.enabled).toBe(false);
  });

  it("多 band 的 peq 块仍按 band 拆成多块（旧语义）", () => {
    const multi: Block[] = [
      {
        id: "m",
        enabled: true,
        bands: [
          { fc: 200, gain_db: 1, q: 1 },
          { fc: 2000, gain_db: -1, q: 2 },
        ],
      },
    ];
    const parsed = parseConfig(buildToml(multi));
    expect(parsed.blocks).toHaveLength(2);
    expect(parsed.blocks.map((b) => b.bands.length)).toEqual([1, 1]);
  });

  it("单声道 channels 触发通道模式，立体声不触发", () => {
    const mono = parseConfigWithTail(
      buildToml(blocks, true, effects, { mode: true, first: "L", active: "L" }),
    );
    expect(mono.channelMode).toBe(true);
    const stereo = parseConfigWithTail(
      buildToml(
        blocks.filter((b) => !b.channel),
        true,
        effects,
      ),
    );
    expect(stereo.channelMode).toBe(false);
  });

  it("未知非 peq 效果器原文进 tail（保存时写回，不破坏第三方效果器）", () => {
    const text = `${buildToml(blocks, true, effects)}[[effects]]\ntype = "thirdparty"\nfoo = 1\n`;
    const parsed = parseConfigWithTail(text);
    expect(parsed.tail).toContain("thirdparty");
    expect(parsed.tail).toContain("foo = 1");
  });

  it("driver 已移除的 release_ms 解析即丢弃并置 droppedRemovedKeys（触发落盘自愈）", () => {
    const text = [
      "version = 1",
      "enabled = true",
      "",
      '[[effects]]',
      'type = "compressor"',
      "enabled = true",
      "threshold_db = -12.0",
      "release_ms = 100.0",
      "ratio = 3.0",
      "",
    ].join("\n");
    const parsed = parseConfigWithTail(text);
    expect(parsed.droppedRemovedKeys).toBe(true);
    expect(parsed.effects[0].params?.release_ms).toBeUndefined();
    expect(parsed.effects[0].params?.ratio).toBe(0.67);
    // 重写后不再含 release_ms，driver 方可接受该文件
    const rewritten = buildToml(parsed.blocks, parsed.enabled, parsed.effects);
    expect(rewritten).not.toContain("release_ms");
    expect(parseConfigWithTail(rewritten).droppedRemovedKeys).toBe(false);
  });

  it("无已移除键时 droppedRemovedKeys=false", () => {
    const parsed = parseConfigWithTail(buildToml(blocks, true, effects));
    expect(parsed.droppedRemovedKeys).toBe(false);
  });

  it("compressor.ratio 读写换算：文件 x:1 ↔ 内部 0~1 斜率（读写各一次）", () => {
    const text = [
      "version = 1",
      "enabled = true",
      "",
      "[[effects]]",
      'type = "compressor"',
      "enabled = true",
      "threshold_db = -12.0",
      "ratio = 3.0",
      "",
    ].join("\n");
    const parsed = parseConfigWithTail(text);
    expect(parsed.effects[0].params?.ratio).toBe(0.67);
    // 写回换算 x:1：1/(1-0.67) ≈ 3.03
    const out = buildToml(parsed.blocks, parsed.enabled, parsed.effects);
    expect(out).toContain("ratio = 3.03");
    // 往返稳定：再读仍是 0.67
    expect(parseConfigWithTail(out).effects[0].params?.ratio).toBe(0.67);
  });

  it("斜率 1.0 写盘 ratio=20（无穷取 20），读回 0.95", () => {
    const eff: EffectItem = { id: "c", type: "compressor", enabled: true, params: { ratio: 1 } };
    const out = buildToml([], true, [eff]);
    expect(out).toContain("ratio = 20");
    expect(parseConfigWithTail(out).effects[0].params?.ratio).toBe(0.95);
  });

  it("畸形 TOML 不再吞半张表：放弃解析、原文进 tail", () => {
    // 这条路径会按设计打 console.error，测试里静音以免污染输出
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const parsed = parseConfigWithTail("this is not toml = = =");
    spy.mockRestore();
    expect(parsed.blocks).toHaveLength(0);
    expect(parsed.tail).toContain("not toml");
  });

  it("单引号 / 行内注释 / 多行数组都能解析（旧手写解析器会静默吞掉）", () => {
    const text = [
      "version = 1",
      "enabled = true # 行内注释",
      "[[effects]]",
      "type = 'wide'",
      "enabled = true",
      "channels = [",
      '  "L",',
      '  "R",',
      "]",
      "gain = 0.1",
      "",
    ].join("\n");
    const parsed = parseConfigWithTail(text);
    expect(parsed.effects[0]).toMatchObject({ type: "wide", channels: ["L", "R"] });
    expect(parsed.effects[0].params?.gain).toBe(0.1);
    expect(parsed.channelMode).toBe(false);
  });
});

describe("buildToml 写盘收口（driver finite_range 越界拒收整份配置）", () => {
  it("band 越界值夹回 driver 范围", () => {
    const b: Block = { id: "x", enabled: true, bands: [{ fc: 5, gain_db: 99, q: 0 }] };
    const out = buildToml([b], true, []);
    expect(out).toContain("fc = 20");
    expect(out).toContain("gain_db = 30");
    expect(out).toContain("q = 0.1");
  });

  it("band 非有限值回默认（fc=1000 / gain=0 / q=1）", () => {
    const b: Block = { id: "x", enabled: true, bands: [{ fc: NaN, gain_db: NaN, q: NaN }] };
    const out = buildToml([b], true, []);
    expect(out).toContain("fc = 1000");
    expect(out).toContain("gain_db = 0");
    expect(out).toContain("q = 1");
  });

  it("效果器参数越界夹到 spec 范围（preamp gain_db 上限 48）", () => {
    const eff: EffectItem = { type: "preamp", enabled: true, params: { gain_db: 999 } };
    const out = buildToml([], true, [eff]);
    expect(out).toContain("gain_db = 48");
  });

  it("效果器参数非有限回 spec 默认（compressor attack_ms 默认 10ms）", () => {
    const eff: EffectItem = { type: "compressor", enabled: true, params: { attack_ms: NaN } };
    const out = buildToml([], true, [eff]);
    expect(out).toContain("attack_ms = 10");
  });

  it("compressor.ratio 仍先经写盘换算再夹取（内部斜率 1.0 → 20:1）", () => {
    const eff: EffectItem = { type: "compressor", enabled: true, params: { ratio: 1 } };
    const out = buildToml([], true, [eff]);
    expect(out).toContain("ratio = 20");
  });

  it("范围内值原样写出（收口不改变合法配置）", () => {
    const b: Block = { id: "x", enabled: true, bands: [{ fc: 1000, gain_db: -3.5, q: 0.707 }] };
    const out = buildToml([b], true, []);
    expect(out).toContain("fc = 1000");
    expect(out).toContain("gain_db = -3.5");
    expect(out).toContain("q = 0.707");
  });
});
