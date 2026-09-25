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

/** 按 x 线性重采样到给定网格（x 单调递增；命中网格点则原样保留）。 */
export function resampleToXs(flat: number[], xs: number[]): number[] {
  const count = flat.length / 2;
  const out: number[] = new Array(xs.length * 2);
  let j = 0;
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i];
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

/** 取两条路径 x 的并集（两边都递增，归并去重；基础网格本就相同）。 */
export function mergeXs(a: number[], b: number[]): number[] {
  const out: number[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length / 2 || j < b.length / 2) {
    const xa = i < a.length / 2 ? a[i * 2] : Infinity;
    const xb = j < b.length / 2 ? b[j * 2] : Infinity;
    let x: number;
    if (Math.abs(xa - xb) < 1e-9) {
      x = xa;
      i++;
      j++;
    } else if (xa < xb) {
      x = xa;
      i++;
    } else {
      x = xb;
      j++;
    }
    if (!out.length || x - out[out.length - 1] > 1e-9) out.push(x);
  }
  return out;
}

/**
 * 把两条路径对齐到**同一条 x 网格**（关键点并集），返回可直接交给 `el.animate` 的 CSS `d`。
 *
 * 为什么是并集而不是"均匀重采样到较大点数"：高 Q 窄峰靠 `buildEvalFreqs` 追加的细化点撑起来
 * （几十个点挤在峰周围），均匀重采样会把它们稀释成两三个点——峰在动画中被削平，
 * 结束时又跳回尖峰，看起来就是"低采样点的曲线变成了高采样点的曲线"。取并集则细化点全保留。
 *
 * 为什么要强制公共网格（而不是各用各的点直接按索引插）：两侧 x 序列不同时，插值会连 x 一起插，
 * 峰在横向漂移——观感是"整条线被揉"而不是"每个关键点各自升降"。
 *
 * 任一侧解析失败或 x 跨度不同（改宽度）时返回 null，放弃动画。
 */
export function alignPaths(a: string, b: string): [string, string] | null {
  const fa = parsePathD(a);
  const fb = parsePathD(b);
  if (!fa || !fb) return null;
  const ca = fa.length / 2;
  const cb = fb.length / 2;
  if (ca < 2 || cb < 2) return null;
  // x 两端必须一致，否则补间会把曲线横向拉扯（如拖动改宽度）
  if (fa[0] !== fb[0] || fa[(ca - 1) * 2] !== fb[(cb - 1) * 2]) return null;
  const xs = mergeXs(fa, fb);
  const ra = resampleToXs(fa, xs);
  const rb = resampleToXs(fb, xs);
  return [`path("${toPathD(ra)}")`, `path("${toPathD(rb)}")`];
}

/**
 * 把路径的 y 从**旧量程的像素**换算到**新量程的像素**。
 *
 * 曲线纵轴量程（`yTop`/`yBottom`）由峰值自适应、还会阶梯跳动（每 2dB 一档）：量程一变，
 * 同一形状的 y 像素含义就完全不同。补间起点若直接沿用旧像素，等于拿"另一套坐标系的形状"
 * 去插值当前坐标系——曲线会先跑到刻度范围外再回来。先换算到新量程，动画就发生在同一坐标系里。
 */
export function remapPathY(
  d: string,
  from: { top: number; bottom: number },
  to: { top: number; bottom: number },
): string {
  const flat = parsePathD(d);
  if (!flat) return d;
  const fromSpan = Math.max(1, from.top - from.bottom);
  const toSpan = Math.max(1, to.top - to.bottom);
  const out = flat.slice();
  for (let i = 1; i < out.length; i += 2) {
    // dbY 的逆：y = 24 + ((top - db) / span) * 180
    const db = from.top - ((out[i] - 24) / 180) * fromSpan;
    // 夹在绘图区内：新量程装不下旧曲线时（纵轴量程按峰值自适应、每 2dB 跳一档），
    // 宁可短暂贴边，也不要让曲线冲出刻度范围再滑回来——那是肉眼可见的破绽。
    out[i] = Math.max(24, Math.min(204, 24 + ((to.top - db) / toSpan) * 180));
  }
  return toPathD(out);
}
