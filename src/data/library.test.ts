// 预设库契约测试（任务 12 后续）：内容合法性 + 中英成对（applyPreset 依赖 group_en/name_en 回退）。
import { describe, expect, it } from "vitest";
import { LIBRARY } from "./library";

describe("预设库（LIBRARY）契约", () => {
  it("至少 1 条且 id 唯一非空", () => {
    expect(LIBRARY.length).toBeGreaterThan(0);
    const ids = LIBRARY.map((p) => p.id);
    expect(ids.every((id) => typeof id === "string" && id.trim() !== "")).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("每条都有分组、名称、描述与至少一个频段", () => {
    for (const p of LIBRARY) {
      expect(p.group.trim()).not.toBe("");
      expect(p.name.trim()).not.toBe("");
      expect(p.desc.trim()).not.toBe("");
      expect(p.bands.length).toBeGreaterThan(0);
    }
  });

  it("中英成对：group_en / name_en / desc_en 与每个频段的 name_en 都存在", () => {
    for (const p of LIBRARY) {
      expect(p.group_en).toBeTruthy();
      expect(p.name_en).toBeTruthy();
      expect(p.desc_en).toBeTruthy();
      for (const b of p.bands) expect(b.name_en).toBeTruthy();
    }
  });

  it("频段参数在合理范围（20–20kHz、|gain| ≤ 12dB、0.1 ≤ Q ≤ 20）", () => {
    for (const p of LIBRARY) {
      for (const b of p.bands) {
        expect(b.fc).toBeGreaterThanOrEqual(20);
        expect(b.fc).toBeLessThanOrEqual(20000);
        expect(Math.abs(b.gain_db)).toBeLessThanOrEqual(12);
        expect(b.q).toBeGreaterThanOrEqual(0.1);
        expect(b.q).toBeLessThanOrEqual(20);
      }
    }
  });

  it("单条预设段数不超过 31（PEQ 上限，避免应用即被拒）", () => {
    for (const p of LIBRARY) expect(p.bands.length).toBeLessThanOrEqual(31);
  });
});
