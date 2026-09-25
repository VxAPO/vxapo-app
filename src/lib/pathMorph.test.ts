import { describe, expect, it } from "vitest";
import { alignPaths, mergeXs, parsePathD, resampleToXs, toPathD } from "./pathMorph";

describe("parsePathD", () => {
  it("解析 M/L 路径为扁平点数组", () => {
    expect(parsePathD("M0.0 10.0 L20.0 30.0")).toEqual([0, 10, 20, 30]);
  });

  it("兼容 commitStyles / getComputedStyle 的 path(\"…\") 形式", () => {
    expect(parsePathD('path("M0.0 10.0 L20.0 30.0")')).toEqual([0, 10, 20, 30]);
  });

  it("非法输入返回 null（宁可不动画也不画错）", () => {
    expect(parsePathD("")).toBeNull();
    expect(parsePathD("L0 0 L1 1")).toBeNull();
    expect(parsePathD("M0 0 L1")).toBeNull(); // 奇数个坐标
    expect(parsePathD("M0 0 Lx 1")).toBeNull();
  });
});

describe("resampleToXs", () => {
  it("按给定网格重采样，命中网格点则数值不变", () => {
    expect(resampleToXs([0, 0, 10, 10], [0, 10])).toEqual([0, 0, 10, 10]);
  });

  it("网格含额外点时插出线性值", () => {
    const out = resampleToXs([0, 0, 10, 10], [0, 5, 10]);
    expect(out).toEqual([0, 0, 5, 5, 10, 10]);
  });
});

describe("mergeXs", () => {
  // 入参是**扁平点数组**（与 parsePathD 一致），只取其中的 x
  it("取并集并去重（基础网格相同，只多出各自的细化点）", () => {
    expect(mergeXs([0, 0, 10, 0, 20, 0], [0, 0, 5, 0, 20, 0])).toEqual([0, 5, 10, 20]);
  });

  it("完全相同的网格不产生重复点", () => {
    expect(mergeXs([0, 0, 10, 0, 20, 0], [0, 0, 10, 0, 20, 0])).toEqual([0, 10, 20]);
  });
});

describe("toPathD", () => {
  it("与 CurvePlot 同精度回写为 M/L 路径", () => {
    expect(toPathD([0.04, 10.06, 20, 30])).toBe("M0.0 10.1 L20.0 30.0");
  });
});

describe("alignPaths", () => {
  it("以关键点并集为公共网格：两侧 x 逐一对应，各自的细化点都不丢", () => {
    const a = "M0.0 0.0 L10.0 0.0";
    const b = "M0.0 5.0 L5.0 9.0 L10.0 0.0";
    const pair = alignPaths(a, b);
    expect(pair).not.toBeNull();
    const [pa, pb] = pair as [string, string];
    const fa = parsePathD(pa);
    const fb = parsePathD(pb);
    expect(fa?.length).toBe(fb?.length);
    // 并集是 0 / 5 / 10 → 3 点
    expect(fa?.length).toBe(6);
    // x 序列必须完全一致，否则插值会连 x 一起插、峰横向漂移
    for (let i = 0; i < 3; i++) {
      expect(fa?.[i * 2]).toBeCloseTo(fb?.[i * 2] ?? -1, 9);
    }
    // b 的细化点 x=5 被保留（不是被均匀化抹掉）
    expect(fa?.[2]).toBeCloseTo(5, 9);
    expect(pa.startsWith('path("M')).toBe(true);
    expect(pb.startsWith('path("M')).toBe(true);
  });

  it("补间只在像素空间进行：两侧 y 原样保留，不做任何量程换算", () => {
    const pair = alignPaths("M0.0 102.0 L10.0 126.0", "M0.0 30.0 L10.0 198.0");
    const [pa, pb] = pair as [string, string];
    expect(parsePathD(pa)).toEqual([0, 102, 10, 126]);
    expect(parsePathD(pb)).toEqual([0, 30, 10, 198]);
  });

  it("x 跨度不同（改宽度）时拒绝补间，避免横向拉扯", () => {
    expect(alignPaths("M0.0 0.0 L20.0 5.0", "M0.0 0.0 L40.0 5.0")).toBeNull();
  });

  it("点数过少或解析失败时返回 null", () => {
    expect(alignPaths("nonsense", "M0.0 0.0 L10.0 0.0")).toBeNull();
    expect(alignPaths("M0.0 0.0", "M0.0 0.0 L10.0 0.0")).toBeNull();
  });
});
