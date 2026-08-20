import { memo, useMemo } from "react";
import type { Block } from "../lib/model";
import { t } from "../lib/i18n";
import { buildEvalFreqs, dbY, logX } from "../lib/curve";
import { bandDb } from "../lib/rbj";
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
      for (const band of b.bands) db += bandDb(f, band, fs);
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

function CurvePlot({ blocks, fs, curveW, yTop, yBottom = -16, preampGainDb = 0 }: CurvePlotProps) {
  const evalFreqs = useMemo(() => buildEvalFreqs(blocks), [blocks]);
  const curveD = useMemo(
    () => freqPath(blocks, fs, curveW, yTop, preampGainDb, evalFreqs, yBottom),
    [blocks, fs, curveW, yTop, preampGainDb, evalFreqs, yBottom],
  );
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
        width={curveW}
        height="220"
        preserveAspectRatio="none"
        role="img"
        aria-label={t("freqResponse")}
        style={{
          cursor:
            'url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 12 12\'><g stroke=\'%23000\' stroke-width=\'1.8\'><path d=\'M6 0v3M6 9v3M0 6h3M9 6h3\'/></g><g stroke=\'%23fff\' stroke-width=\'0.8\'><path d=\'M6 0v3M6 9v3M0 6h3M9 6h3\'/></g></svg>") 6 6, crosshair',
        }}
        onMouseMove={onSvgMove}
        onMouseLeave={onMouseLeave}
      >
        <CurveGrid curveW={curveW} yTop={yTop} yBottom={yBottom} />
        <path d={curveD} fill="none" stroke="var(--brand-deep)" strokeWidth="2" />
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
              stroke="var(--brand-deep)"
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
