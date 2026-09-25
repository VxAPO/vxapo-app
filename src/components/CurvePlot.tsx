import { memo, useLayoutEffect, useMemo, useRef } from "react";
import type { Block } from "../lib/model";
import { t } from "../lib/i18n/core";
import { buildEvalFreqs, dbY, logX } from "../lib/curve";
import { bandDbCached } from "../lib/rbj";
import { alignPaths } from "../lib/pathMorph";
import { useCurveHover } from "../hooks/useCurveHover";
import CurveGrid from "./CurveGrid";

function freqPath(
  blocks: Block[],
  fs: number,
  w: number,
  top: number,
  preampGainDb = 0,
  freqs?: number[],
  bottom = -16,
): string {
  const pts: string[] = [];
  const evalFreqs = freqs ?? Array.from({ length: 241 }, (_, i) => 20 * Math.pow(1000, i / 240));
  for (const f of evalFreqs) {
    let db = preampGainDb;
    for (const b of blocks) {
      if (!b.enabled) continue;
      for (const band of b.bands) db += bandDbCached(f, band, fs);
    }
    const clamped = Math.max(bottom, Math.min(top, db));
    pts.push(`${logX(f, w).toFixed(1)} ${dbY(clamped, top, bottom).toFixed(1)}`);
  }
  return `M${pts.join(" L")}`;
}

function fmtFreq(f: number): string {
  return f >= 1000 ? `${(f / 1000).toFixed(2)} kHz` : `${Math.round(f)} Hz`;
}

function fmtDb(db: number): string {
  return `${db >= 0 ? "+" : ""}${db.toFixed(1)} dB`;
}

interface CurvePlotProps {
  blocks: Block[];
  fs: number;
  curveW: number;
  yTop: number;
  yBottom?: number;
  preampGainDb?: number;
}

function CurvePlot({
  blocks,
  fs,
  curveW,
  yTop,
  yBottom = -16,
  preampGainDb = 0,
}: CurvePlotProps) {
  // 曲线路径始终按当前 curveW/blocks 重算，保证与网格/viewBox 完全一致，
  // 拖拽改宽度时不会出现"旧宽度的线配当前宽度网格"导致的越界。
  const curveD = useMemo(
    () => freqPath(blocks, fs, curveW, yTop, preampGainDb, buildEvalFreqs(blocks), yBottom),
    [blocks, fs, curveW, yTop, preampGainDb, yBottom],
  );
  const pathRef = useRef<SVGPathElement | null>(null);
  const morphAnimRef = useRef<Animation | null>(null);
  // 用 layout effect：必须在浏览器绘制**之前**接管，否则新 d 会先画一帧再被动画拉回去（闪一下）
  useLayoutEffect(() => {
    const el = pathRef.current;
    if (!el) return;
    /**
     * 曲线自己会变形：只要路径变了就平滑补间过去，不区分场景——切声道、开关/增删滤波器、
     * 拖频段参数、切设备全走这一条路，调用方不必再特判「该不该动画」。
     *
     * 起点取**当前实际渲染**的 d（含上一条动画的中间值），不是「上一次的 d」：这样变形途中
     * 目标又变时会从当前位置接着跑，不会跳回旧值。连续变更（拖滑块）因此表现为指数式平滑
     * 跟随，松手后自然收敛到准确值。
     *
     * 采样点数量随滤波器集合变化（`buildEvalFreqs` 会追加中心频率与高 Q 细化点），
     * 直接补间两条点数不同的路径会画出乱线；点数对齐交给 `alignPaths`，两侧 x 跨度不一致
     * （改宽度/换量程）时它返回 null，此时宁可不动画。
     */
    const shown = getComputedStyle(el).getPropertyValue("d");
    const from = shown && shown !== "none" ? shown : curveD;
    const pair = alignPaths(from, curveD);
    if (!pair) return;
    // 只取消我们自己起的动画：curve.css 里 stroke 的 CSS 过渡别动
    morphAnimRef.current?.cancel();
    morphAnimRef.current = el.animate([{ d: pair[0] }, { d: pair[1] }], {
      // 320ms 与 stroke 过渡的 0.32s 对齐；不设 fill，结束后回到 React 写入的 d
      duration: 320,
      easing: "cubic-bezier(0.4, 0, 0.2, 1)",
    });
  }, [curveD]);

  const plotTop = dbY(yTop, yTop, yBottom);
  const plotBottom = dbY(yBottom, yTop, yBottom);
  const { hoverPt, tipPos, svgRef, tipRef, onSvgMove, onMouseLeave } = useCurveHover({
    blocks,
    fs,
    curveW,
    yTop,
    yBottom,
    preampGainDb,
  });

  return (
    <>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${curveW} 220`}
        height="220"
        preserveAspectRatio="none"
        role="img"
        aria-label={t("freqResponse")}
        style={{
          width: "calc(100% + 28px)",
          cursor:
            'url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 12 12\'><g stroke=\'%23000\' stroke-width=\'1.8\'><path d=\'M6 0v3M6 9v3M0 6h3M9 6h3\'/></g><g stroke=\'%23fff\' stroke-width=\'0.8\'><path d=\'M6 0v3M6 9v3M0 6h3M9 6h3\'/></g></svg>") 6 6, crosshair',
        }}
        onMouseMove={onSvgMove}
        onMouseLeave={onMouseLeave}
      >
        <CurveGrid curveW={curveW} yTop={yTop} yBottom={yBottom} />
        <path ref={pathRef} d={curveD} fill="none" stroke="var(--curve-path)" strokeWidth="2" />
        {hoverPt && (
          <>
            <line
              x1={hoverPt.x}
              y1={plotTop}
              x2={hoverPt.x}
              y2={plotBottom}
              stroke="var(--border-strong)"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
            <circle
              cx={hoverPt.x}
              cy={hoverPt.y}
              r="3"
              fill="var(--card)"
              stroke="var(--curve-path)"
              strokeWidth="2"
            />
          </>
        )}
      </svg>
      {hoverPt && tipPos && (
        <div className="curve-tip" ref={tipRef}>
          <div className="curve-tip-body">
            <div className="curve-tip-text">
              <span>{fmtFreq(hoverPt.f)}</span>
              <span className="tip-gain">{fmtDb(hoverPt.db)}</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default memo(CurvePlot);
