// driver 生成表 ↔ UI 参数定义的一致性（A4 首批；锁定决策 2 的契约）
import { describe, expect, it } from "vitest";
import {
  EFFECT_DEFS,
  KNOWN_EFFECT_TYPES,
  UI_PARAM_RANGES,
  defaultEffectParams,
  effectParams,
  effectsEqual,
  fromDriverParam,
  semanticStrength,
  toDriverParam,
  applySemanticStrength,
} from "./effects";
import { EFFECT_PARAM_SPECS } from "./effects.generated";
import type { EffectItem } from "./model";

describe("effects.generated ↔ effects.ts", () => {
  it("生成表覆盖全部 UI 效果器", () => {
    const ids = EFFECT_PARAM_SPECS.map((e) => e.effect);
    for (const d of EFFECT_DEFS) expect(ids).toContain(d.type);
    expect(KNOWN_EFFECT_TYPES).toEqual(EFFECT_DEFS.map((e) => e.type));
  });

  it("每个参数自洽：min < max、step > 0、默认值落在范围内", () => {
    for (const spec of EFFECT_PARAM_SPECS) {
      for (const p of spec.params) {
        expect(p.min).toBeLessThan(p.max);
        expect(p.step).toBeGreaterThan(0);
        expect(p.default).toBeGreaterThanOrEqual(p.min);
        expect(p.default).toBeLessThanOrEqual(p.max);
      }
    }
  });

  it("effectParams 键序与生成表一致；范围/步进一致，显示域例外（UI_PARAM_RANGES）优先", () => {
    for (const spec of EFFECT_PARAM_SPECS) {
      const ui = effectParams(spec.effect);
      expect(ui.map((p) => p.key)).toEqual(spec.params.map((p) => p.key));
      ui.forEach((p, i) => {
        const id = `${spec.effect}.${spec.params[i].key}`;
        const over = UI_PARAM_RANGES[id];
        expect(p.min).toBe(over?.min ?? spec.params[i].min);
        expect(p.max).toBe(over?.max ?? spec.params[i].max);
        expect(p.step).toBe(over?.step ?? spec.params[i].step);
      });
    }
    // 压缩比显示域：0~1 斜率、0.01 步进（driver 表是 x:1 的 1..20/0.5）。
    const ratio = effectParams("compressor").find((p) => p.key === "ratio");
    expect(ratio).toMatchObject({ min: 0, max: 1, step: 0.01 });
  });

  it("UI 起点覆盖生成表的全部参数（driver 新增参数也会有初值）", () => {
    for (const spec of EFFECT_PARAM_SPECS) {
      const defaults = defaultEffectParams(spec.effect);
      expect(Object.keys(defaults).sort()).toEqual(spec.params.map((p) => p.key).sort());
    }
  });

  it("默认值换算进内部值域：ratio 默认 3:1 → 0.67", () => {
    expect(defaultEffectParams("compressor").ratio).toBe(0.67);
  });
});

describe("compressor.ratio 内外换算（读/写 TOML 各一次）", () => {
  it("读：driver x:1 → 0~1 斜率（1→0、3→0.67、20→0.95，非 finite → 0）", () => {
    expect(fromDriverParam("compressor", "ratio", 1)).toBe(0);
    expect(fromDriverParam("compressor", "ratio", 3)).toBe(0.67);
    expect(fromDriverParam("compressor", "ratio", 20)).toBe(0.95);
    expect(fromDriverParam("compressor", "ratio", NaN)).toBe(0);
    // 非换算键原样透传
    expect(fromDriverParam("wide", "gain", 0.5)).toBe(0.5);
  });

  it("写：0~1 斜率 → driver x:1（0.67→3.03、≥0.95→20、v=1→20 无穷取 20）", () => {
    expect(toDriverParam("compressor", "ratio", 0)).toBe(1);
    expect(toDriverParam("compressor", "ratio", 0.67)).toBe(3.03);
    expect(toDriverParam("compressor", "ratio", 0.95)).toBe(20);
    expect(toDriverParam("compressor", "ratio", 0.96)).toBe(20);
    expect(toDriverParam("compressor", "ratio", 1)).toBe(20);
    expect(toDriverParam("wide", "gain", 0.5)).toBe(0.5);
  });

  it("0.95~1.0 段写盘等价 20:1：拖满的 1.0 读回 0.95 不判为外部改动（不弹回）", () => {
    const mk = (ratio: number): EffectItem[] => [
      { id: "compressor:all", type: "compressor", enabled: true, params: { ratio } },
    ];
    expect(effectsEqual(mk(1), mk(0.95))).toBe(true);
    expect(effectsEqual(mk(1), mk(0.96))).toBe(true);
    expect(effectsEqual(mk(0.67), mk(0.9))).toBe(false);
    expect(effectsEqual(mk(0.67), mk(0.67))).toBe(true);
  });

  it("语义视图与参数视图同一份值：strength = v，写回 v = s（往返恒等）", () => {
    expect(semanticStrength("compressor", { ratio: 0.67 })).toBeCloseTo(0.67, 10);
    for (const s of [0, 0.34, 0.67, 1]) {
      const back = applySemanticStrength("compressor", s, { ratio: 0.67 });
      expect(back.ratio).toBe(s);
      expect(semanticStrength("compressor", back)).toBe(s);
    }
  });
});
