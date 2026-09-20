// driver 生成表 ↔ UI 参数定义的一致性（A4 首批；锁定决策 2 的契约）
import { describe, expect, it } from "vitest";
import { EFFECT_DEFS, KNOWN_EFFECT_TYPES, defaultEffectParams, effectParams } from "./effects";
import { EFFECT_PARAM_SPECS } from "./effects.generated";

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

  it("effectParams 的键序与范围/步进与生成表逐项一致（UI 展示顺序不变）", () => {
    for (const spec of EFFECT_PARAM_SPECS) {
      const ui = effectParams(spec.effect);
      expect(ui.map((p) => p.key)).toEqual(spec.params.map((p) => p.key));
      ui.forEach((p, i) => {
        expect(p.min).toBe(spec.params[i].min);
        expect(p.max).toBe(spec.params[i].max);
        expect(p.step).toBe(spec.params[i].step);
      });
    }
  });

  it("UI 起点覆盖生成表的全部参数（driver 新增参数也会有初值）", () => {
    for (const spec of EFFECT_PARAM_SPECS) {
      const defaults = defaultEffectParams(spec.effect);
      expect(Object.keys(defaults).sort()).toEqual(spec.params.map((p) => p.key).sort());
    }
  });
});
