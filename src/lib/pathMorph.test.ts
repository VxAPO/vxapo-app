import { describe, expect, it } from "vitest";
import { alignPaths, parsePathD, resampleByX, toPathD } from "./pathMorph";

describe("parsePathD", () => {
  it("解析 M/L 路径为扁平点数组", () => {
    expect(parsePathD("M0.0 10.0 L20.0 30.0")).toEqual([0, 10, 20, 30]);
  });

  it("兼容 getComputedStyle 返回的 path(\"…\") 形式", () => {
    expect(parsePathD('path("M0.0 10.0 L20.0 30.0")')).toEqual([0, 10, 20, 30]);
  });

  it("非法输入返回 null（宁可不动画也不画错）", () => {
    expect(parsePathD("")).toBeNull();
    expect(parsePathD("L0 0 L1 1")).toBeNull();
    expect(parsePathD("M0 0 L1")).toBeNull(); // 奇数个坐标
    expect(parsePathD("M0 0 Lx 1")).toBeNull();
  });
});

describe("resampleByX", () => {
  it("重采样到指定点数且保持端点", () => {
    const out = resampleByX([0, 0, 10, 10, 20, 20], 5);
    expect(out).toEqual([0, 0, 5, 5, 10, 10, 15, 15, 20, 20]);
  });

  it("点数相同则原样返回（不引入插值误差）", () => {
    expect(resampleByX([0, 0, 10, 10], 2)).toEqual([0, 0, 10, 10]);
  });

  it("按 x 而非索引重采样：节点疏密不均也保持线性", () => {
    // x 在 0、1、10 上取值 0、1、10（y = x），重采样到 5 点应仍落在 y = x 上
    const out = resampleByX([0, 0, 1, 1, 10, 10], 5);
    expect(out[2]).toBeCloseTo(2.5, 6);
    expect(out[3]).toBeCloseTo(2.5, 6);
    expect(out[4]).toBeCloseTo(5, 6);
    expect(out[5]).toBeCloseTo(5, 6);
  });
});

describe("toPathD", () => {
  it("与 CurvePlot 同精度回写为 M/L 路径", () => {
    expect(toPathD([0.04, 10.06, 20, 30])).toBe("M0.0 10.1 L20.0 30.0");
  });
});

describe("alignPaths", () => {
  it("点数不同时对齐到较大者，便于 d 插值", () => {
    const a = "M0.0 0.0 L10.0 10.0";
    const b = "M0.0 5.0 L5.0 5.0 L10.0 5.0";
    const pair = alignPaths(a, b);
    expect(pair).not.toBeNull();
    const [pa, pb] = pair as [string, string];
    expect(parsePathD(pa)?.length).toBe(parsePathD(pb)?.length);
    expect(parsePathD(pa)?.length).toBe(6); // 3 点 × 2 坐标
    expect(pa.startsWith('path("M')).toBe(true);
    expect(pb.startsWith('path("M')).toBe(true);
  });

  it("x 跨度不同（改宽度 / 换量程）时拒绝补间，避免横向拉扯", () => {
    expect(alignPaths("M0.0 0.0 L20.0 5.0", "M0.0 0.0 L40.0 5.0")).toBeNull();
  });

  it("解析失败时返回 null", () => {
    expect(alignPaths("nonsense", "M0.0 0.0 L10.0 0.0")).toBeNull();
  });
});
