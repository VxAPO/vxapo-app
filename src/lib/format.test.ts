// dB 数值格式化：先四舍五入再定符号（归一化把峰值压到 0 附近时不能显示成 "-0.0"）。
import { describe, expect, it } from "vitest";
import { fmtDb1 } from "./format";

describe("fmtDb1", () => {
  it("正数带 +、负数带 -，保留 1 位小数", () => {
    expect(fmtDb1(3)).toBe("+3.0");
    expect(fmtDb1(0.06)).toBe("+0.1");
    expect(fmtDb1(-3.26)).toBe("-3.3");
  });

  it("舍入到 0 附近时既不带负号也不带正号", () => {
    expect(fmtDb1(0)).toBe("0.0");
    expect(fmtDb1(-0)).toBe("0.0");
    expect(fmtDb1(-0.04)).toBe("0.0");
    expect(fmtDb1(0.04)).toBe("0.0");
  });
});
