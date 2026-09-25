/**
 * 曲线路径的「变形」工具：把两条 `M x y L x y …` 对齐到同一采样点数，供 `d` 补间使用。
 *
 * 为什么必须有这一层：曲线的采样点**不是固定数量**。`buildEvalFreqs` 在 481 点对数网格
 * 之外，还会追加每个启用频段的中心频率、高 Q 邻域的细化点、相邻中心的中点——换一个声道、
 * 开关一个滤波器，点数就变了。而 `d` 的插值要求两侧命令序列逐段对应，点数不同时浏览器
 * 无法插值：要么直接跳到终值（看不到动画），要么按索引硬配出一团乱线（踩过）。
 *
 * 对齐按 **x（对数频率，单调递增）** 重采样，不是按索引：细节点是插进原数组的、间距不均匀，
 * 按索引重采样会把频率轴一起拖变形。
 *
 * 只用于**动画过程**：动画不设 fill，结束后元素回到 React 写入的原始 d，
 * 所以重采样不会污染最终渲染的曲线形状。
 */

/** 剥掉 CSS `path("…")` 外壳，取纯 path 数据（`getComputedStyle` 返回的是这种形式）。 */
function stripPathFn(d: string): string {
  const s = d.trim();
  if (!s.startsWith("path(")) return s;
  const inner = s.endsWith(")") ? s.slice(5, -1) : s.slice(5);
  return inner.trim().replace(/^["']|["']$/g, "").trim();
}

/**
 * `M12.3 45.6 L13.1 46.2 …` → `[x0, y0, x1, y1, …]`。
 * 兼容 `path("…")` 形式（`getComputedStyle(el).d` 返回的就是那种）。
 * 解析失败返回 null，调用方据此放弃动画（宁可不动，也不要画错）。
 */
export function parsePathD(d: string): number[] | null {
  if (!d) return null;
  const raw = stripPathFn(d);
  if (!raw.startsWith("M")) return null;
  // 本模块生成的路径只含 M/L 与数字；L 当分隔符处理即可
  const parts = raw
    .slice(1)
    .replace(/[Ll]/g, " ")
    .trim()
    .split(/\s+/);
  if (parts.length < 4 || parts.length % 2 !== 0) return null;
  const nums = parts.map(Number);
  if (nums.some((n) => !Number.isFinite(n))) return null;
  return nums;
}

/** `[x0, y0, x1, y1, …]` → `M x y L x y …`（精度与 CurvePlot 一致）。 */
export function toPathD(flat: number[]): string {
  const pts: string[] = [];
  for (let i = 0; i < flat.length; i += 2) {
    pts.push(`${flat[i].toFixed(1)} ${flat[i + 1].toFixed(1)}`);
  }
  return `M${pts.join(" L")}`;
}

/** 按 x 线性重采样到 n 个点（x 单调递增；两端点原样保留）。 */
export function resampleByX(flat: number[], n: number): number[] {
  const count = flat.length / 2;
  if (count === n) return flat.slice();
  const x0 = flat[0];
  const x1 = flat[(count - 1) * 2];
  const out: number[] = new Array(n * 2);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const x = n === 1 ? x0 : x0 + ((x1 - x0) * i) / (n - 1);
    while (j < count - 2 && flat[(j + 1) * 2] < x) j++;
    const xa = flat[j * 2];
    const xb = flat[(j + 1) * 2];
    const t = xb === xa ? 0 : (x - xa) / (xb - xa);
    const f = t < 0 ? 0 : t > 1 ? 1 : t;
    out[i * 2] = x;
    out[i * 2 + 1] = flat[j * 2 + 1] + (flat[(j + 1) * 2 + 1] - flat[j * 2 + 1]) * f;
  }
  return out;
}

/**
 * 把两条路径对齐到同一点数（取两者较大者），返回可直接交给 `el.animate` 的 CSS `d` 值。
 * 任一侧解析失败或两条曲线 x 跨度不同（换了宽度/量程，不该做形状补间）时返回 null。
 */
export function alignPaths(a: string, b: string): [string, string] | null {
  const fa = parsePathD(a);
  const fb = parsePathD(b);
  if (!fa || !fb) return null;
  const ca = fa.length / 2;
  const cb = fb.length / 2;
  // x 两端必须一致，否则补间会把曲线横向拉扯（如拖动改宽度、Y 轴量程变化）
  if (fa[0] !== fb[0] || fa[(ca - 1) * 2] !== fb[(cb - 1) * 2]) return null;
  const n = Math.max(ca, cb);
  const ra = ca === n ? fa : resampleByX(fa, n);
  const rb = cb === n ? fb : resampleByX(fb, n);
  return [`path("${toPathD(ra)}")`, `path("${toPathD(rb)}")`];
}
