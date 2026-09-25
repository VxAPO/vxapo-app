import { memo, useEffect, useMemo, useRef } from "react";
import type { Block } from "../lib/model";
import { t } from "../lib/i18n/core";
import { buildEvalFreqs, dbY, logX } from "../lib/curve";
import { bandDbCached } from "../lib/rbj";
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
  /** 声道标识：值变化时把曲线**补间**过去，而不是直接换 d。
      页面切换之所以不闪，是因为它只平移、曲线本身不重算；切声道必然重算，
      所以这里补上平滑变形，避免两条完全不同形状的曲线之间"跳"一下。 */
  morphKey?: string;
}

function CurvePlot({
  blocks,
  fs,
  curveW,
  yTop,
  yBottom = -16,
  preampGainDb = 0,
  morphKey,
}: CurvePlotProps) {
  // 曲线路径始终按当前 curveW/blocks 重算，保证与网格/viewBox 完全一致，
  // 拖拽改宽度时不会出现"旧宽度的线配当前宽度网格"导致的越界。
  const curveD = useMemo(
    () => freqPath(blocks, fs, curveW, yTop, preampGainDb, buildEvalFreqs(blocks), yBottom),
    [blocks, fs, curveW, yTop, preampGainDb, yBottom],
  );
  const pathRef = useRef<SVGPathElement | null>(null);
  const prevDRef = useRef<string | null>(null);
  const morphKeyRef = useRef(morphKey);
  useEffect(() => {
    const el = pathRef.current;
    const prev = prevDRef.current;
    const switched = morphKeyRef.current !== morphKey;
    morphKeyRef.current = morphKey;
    prevDRef.current = curveD;
    // 只在**声道切换**时补间。拖参数时 d 每帧都在变，补间会变成橡皮筋式滞后。
    if (!el || !prev || !switched || prev === curveD) return;
    // 320ms 与 curve.css 里 stroke 过渡的 0.32s 对齐（同一条 `cubic-bezier(0.4,0,0.2,1)`）。
    // d 的插值要求两侧命令序列一致：本组件固定 241 个采样点，点与结构都相同。
    el.animate([{ d: `path("${prev}")` }, { d: `path("${curveD}")` }], {
      duration: 320,
      easing: "cubic-bezier(0.4, 0, 0.2, 1)",
    });
  }, [curveD, morphKey]);

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
