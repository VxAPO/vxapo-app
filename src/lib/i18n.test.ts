// i18n 查表（A4 首批）
import { describe, expect, it } from "vitest";
import { getLang, setLang, t } from "./i18n/core";

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
});
