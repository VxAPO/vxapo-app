// config.toml 生成/解析往返（A4 首批；同时锁定决策 3 的行为）
import { describe, expect, it, vi } from "vitest";
import type { Block, EffectItem } from "./model";
import { buildToml, parseConfig, parseConfigWithTail } from "./toml";

const blocks: Block[] = [
  { id: "b1", enabled: true, bands: [{ fc: 100, gain_db: 3, q: 1.2, kind: "low_shelf" }] },
  { id: "b2", enabled: false, bands: [{ fc: 8000, gain_db: -2, q: 0.7, kind: "high_shelf" }] },
];
const effects: EffectItem[] = [
  { id: "wide:all", type: "wide", enabled: true, params: { mix: 0.55 } },
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
    expect(parsed.effects[0].params?.mix).toBe(0.55);
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
