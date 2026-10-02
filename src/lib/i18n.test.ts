// i18n 查表（A4 首批）
import { afterEach, describe, expect, it } from "vitest";
import { PERCEPTUAL_LABELS } from "./blocks";
import { LIBRARY } from "../data/library";
import {
  customBandNameFields,
  customPresetDefaultName,
  displayBandName,
  displayPresetName,
  getLang,
  isDefaultPresetName,
  perceptualLabelPair,
  setLang,
  t,
} from "./i18n/core";

describe("i18n t()", () => {
  it("中英词条都能取到且不同", () => {
    setLang("zh");
    const zh = t("settings");
    setLang("en");
    const en = t("settings");
    expect(zh).toBeTruthy();
    expect(en).toBeTruthy();
    expect(zh).not.toBe(en);
  });

  it("缺词条回落为 key 本身", () => {
    setLang("zh");
    expect(t("definitely.missing.key")).toBe("definitely.missing.key");
  });

  it("{var} 插值", () => {
    setLang("zh");
    expect(t("confirm.deletePreset", { name: "测试预设" })).toContain("测试预设");
  });

  it("setLang / getLang 往返", () => {
    setLang("en");
    expect(getLang()).toBe("en");
    setLang("zh");
    expect(getLang()).toBe("zh");
  });

  // `semanticName` 无频段时回退的中文字面量也要能翻（显示处走 `t(...)`）。
  it("「未命名」占位符中英成对，不残留中文", () => {
    setLang("zh");
    expect(t("未命名")).toBe("未命名");
    setLang("en");
    expect(t("未命名")).toBe("Unnamed");
    setLang("zh");
  });
});

// ── 语义描述的默认映射反查（自定义预设） ────────────────────────────────────

describe("displayBandName / 默认映射反查", () => {
  afterEach(() => setLang("zh"));

  it("语义视图的默认映射标签双向可查", () => {
    setLang("en");
    expect(displayBandName("中频临场感")).toBe("Mid Presence");
    setLang("zh");
    expect(displayBandName("Mid Presence")).toBe("中频临场感");
  });

  it("中英两侧写法都能反查到，英→中不再原样漏出", () => {
    setLang("zh");
    expect(displayBandName("低频冲击感")).toBe("低频冲击感");
    expect(displayBandName("Bass Impact")).toBe("低频冲击感");
    setLang("en");
    expect(displayBandName("Bass Impact")).toBe("Bass Impact");
  });

  it("perceptualLabelPair：认得出成对，用户自写的返回 null", () => {
    expect(perceptualLabelPair("中频临场感")).toEqual({
      zh: "中频临场感",
      en: "Mid Presence",
    });
    expect(perceptualLabelPair("Mid Presence")).toEqual({
      zh: "中频临场感",
      en: "Mid Presence",
    });
    expect(perceptualLabelPair("我自己写的")).toBeNull();
  });

  // 契约：语义视图的每一档默认映射都必须能双向反查，否则「保存后切语言」那一步会漏原文。
  // 覆盖 PERCEPTUAL_LABELS 全集，避免以后加频段只加了区间表、忘了 i18n 词条。
  it("感知区间全集：中英词条齐全且双向一一对应", () => {
    for (const zhLabel of PERCEPTUAL_LABELS) {
      const pair = perceptualLabelPair(zhLabel);
      expect(pair, `缺少词条或未成对：${zhLabel}`).not.toBeNull();
      const enLabel = pair!.en;
      expect(enLabel).not.toBe(zhLabel);
      // 英文写法也要认得（用户可能在英文界面保存）
      expect(perceptualLabelPair(enLabel)).toEqual({ zh: zhLabel, en: enLabel });
      setLang("en");
      expect(displayBandName(zhLabel)).toBe(enLabel);
      setLang("zh");
      expect(displayBandName(enLabel)).toBe(zhLabel);
    }
  });

  // 反查优先级：库内建段名表在前、感知标签表在后。两者若撞名，优先级会决定显示结果，
  // 所以钉住「不撞名」这一前提（撞了就得重新想优先级，不能默默盖掉）。
  it("库内建段名与感知标签不撞名（否则反查优先级会互相盖）", () => {
    for (const zhLabel of PERCEPTUAL_LABELS) {
      const pair = perceptualLabelPair(zhLabel)!;
      // LIBRARY 里同名的中/英段名一旦存在，下面的断言就会失败
      expect(LIBRARY.some((p) => p.bands.some((b) => b.name === zhLabel))).toBe(false);
      expect(LIBRARY.some((p) => p.bands.some((b) => b.name_en === pair.en))).toBe(false);
    }
  });
});

describe("customBandNameFields（入库字段）", () => {
  it("默认映射成对入库，切语言可反查", () => {
    expect(customBandNameFields("中频临场感")).toEqual({
      name: "中频临场感",
      name_en: "Mid Presence",
    });
  });

  it("用户自写的只存原文、不补译名（切语言不篡改用户文字）", () => {
    expect(customBandNameFields("  我的低音  ")).toEqual({ name: "我的低音" });
  });

  it("留空不写 name", () => {
    expect(customBandNameFields("   ")).toEqual({});
  });
});

describe("displayPresetName / 默认预设名反查", () => {
  afterEach(() => setLang("zh"));

  it("成对入库的默认名双向显示", () => {
    const p = { name: "自定义预设 1", name_en: "Custom preset 1" };
    setLang("zh");
    expect(displayPresetName(p)).toBe("自定义预设 1");
    setLang("en");
    expect(displayPresetName(p)).toBe("Custom preset 1");
  });

  it("旧数据只存中文默认名：切英文也能重拼，不再漏出旧语言", () => {
    setLang("en");
    expect(displayPresetName({ name: "自定义预设 2" })).toBe("Custom preset 2");
  });

  it("用户自己写的名字原样显示", () => {
    setLang("en");
    expect(displayPresetName({ name: "我的游戏预设" })).toBe("我的游戏预设");
    setLang("zh");
    expect(displayPresetName({ name: "我的游戏预设" })).toBe("我的游戏预设");
  });

  it("清空名称回退成不带序号的占位名时，也按当前语言显示", () => {
    setLang("en");
    expect(displayPresetName({ name: "自定义预设" })).toBe("Custom preset");
    setLang("zh");
    expect(displayPresetName({ name: "Custom preset" })).toBe("自定义预设");
  });

  it("customPresetDefaultName 中英成对且序号在末尾", () => {
    expect(customPresetDefaultName(3)).toEqual({
      zh: "自定义预设 3",
      en: "Custom preset 3",
    });
  });

  it("isDefaultPresetName：带/不带序号的默认名与空串都算默认，用户文字不算", () => {
    expect(isDefaultPresetName("")).toBe(true);
    expect(isDefaultPresetName("自定义预设")).toBe(true);
    expect(isDefaultPresetName("自定义预设 3")).toBe(true);
    expect(isDefaultPresetName("Custom preset")).toBe(true);
    expect(isDefaultPresetName("Custom preset 3")).toBe(true);
    expect(isDefaultPresetName("我的游戏预设")).toBe(false);
    expect(isDefaultPresetName("我的游戏预设 3")).toBe(false);
  });
});
