import { useMemo, useRef, useState, type MouseEvent } from "react";
import type { Block } from "../lib/model";

function logX(freq: number, w: number): number {
  const t = (Math.log10(Math.max(20, Math.min(20000, freq))) - Math.log10(20)) / 3;
  return 40 + t * (w - 80);
}

export function peakingDb(freq: number, fc: number, gainDb: number, q: number, fs: number): number {
  const f = Math.max(10, Math.min(fs * 0.49, freq));
  const center = Math.max(10, Math.min(fs * 0.49, fc));
  const qq = Math.max(0.1, Math.min(20, q));
  const a = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * center) / fs;
  const cw = Math.cos(w0);
  const sw = Math.sin(w0);
  const alpha = sw / (2 * qq);
  const b0 = 1 + alpha * a;
  const b1 = -2 * cw;
  const b2 = 1 - alpha * a;
  const a0 = 1 + alpha / a;
  const a1 = -2 * cw;
  const a2 = 1 - alpha / a;
  const w = (2 * Math.PI * f) / fs;
  const c = Math.cos(w);
  const s = Math.sin(w);
  const c2 = Math.cos(2 * w);
  const s2 = Math.sin(2 * w);
  const num = Math.hypot(b0 + b1 * c + b2 * c2, b1 * s + b2 * s2);
  const den = Math.hypot(a0 + a1 * c + a2 * c2, a1 * s + a2 * s2);
  return 20 * Math.log10(num / den);
}

function dbY(db: number, top: number): number {
  return 24 + ((top - db) / (top + 16)) * 180;
}

function freqPath(blocks: Block[], fs: number, w: number, top: number): string {
  const pts: string[] = [];
  for (let i = 0; i <= 240; i++) {
    const f = 20 * Math.pow(1000, i / 240);
    let db = 0;
    for (const b of blocks) {
      if (!b.enabled) continue;
      for (const band of b.bands) db += peakingDb(f, band.fc, band.gain_db, band.q, fs);
    }
    const clamped = Math.max(-16, Math.min(top, db));
    pts.push(`${logX(f, w).toFixed(1)} ${dbY(clamped, top).toFixed(1)}`);
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
}

interface HoverPt {
  x: number;
  y: number;
  f: number;
  db: number;
  cvx: number;
  cvy: number;
}

export default function CurvePlot({ blocks, fs, curveW, yTop }: CurvePlotProps) {
  const [hoverPt, setHoverPt] = useState<HoverPt | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);

  const yStep = yTop + 16 > 26 ? 4 : 2;
  const yGrid = useMemo(() => {
    const g: { db: number; y: number }[] = [];
    for (let db = yTop; db > -16; db -= yStep) g.push({ db, y: dbY(db, yTop) });
    g.push({ db: -16, y: dbY(-16, yTop) });
    return g;
  }, [yTop, yStep]);
  const plotTop = dbY(yTop, yTop);
  const plotBottom = dbY(-16, yTop);
  const xGrid = useMemo(
    () => [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000].map((f) => logX(f, curveW)),
    [curveW],
  );
  const xLabels = ["20", "50", "100", "200", "500", "1k", "2k", "5k", "10k", "20k"];
  const curveD = useMemo(
    () => freqPath(blocks, fs, curveW, yTop),
    [blocks, fs, curveW, yTop],
  );

  const onSvgMove = (e: MouseEvent<SVGSVGElement>) => {
    const svgRect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - svgRect.left;
    const py = e.clientY - svgRect.top;
    const viewX = (px / svgRect.width) * curveW;
    const viewY = (py / svgRect.height) * 220;
    const t = (viewX - 40) / (curveW - 80);
    const f = 20 * Math.pow(10, t * 3);
    const cl = Math.max(20, Math.min(20000, f));
    const x = logX(cl, curveW);
    let db = 0;
    for (const b of blocks) {
      if (!b.enabled) continue;
      for (const band of b.bands) db += peakingDb(cl, band.fc, band.gain_db, band.q, fs);
    }
    const clamped = Math.max(-16, Math.min(yTop, db));
    setHoverPt({
      x,
      y: dbY(clamped, yTop),
      f: cl,
      db,
      cvx: viewX,
      cvy: viewY,
    });
  };

  const tipPos = (() => {
    if (!hoverPt) return null;
    const wrap = svgRef.current?.parentElement?.getBoundingClientRect();
    const svg = svgRef.current?.getBoundingClientRect();
    if (!wrap || !svg) return null;
    const tipW = tipRef.current?.offsetWidth ?? 96;
    const tipH = tipRef.current?.offsetHeight ?? 40;
    const sx = svg.left - wrap.left;
    const sy = svg.top - wrap.top;
    const scaleX = svg.width / curveW;
    const scaleY = svg.height / 220;
    const cx = sx + hoverPt.cvx * scaleX;
    const cy = sy + hoverPt.cvy * scaleY;
    const my = sy + hoverPt.y * scaleY;
    const plotLeft = sx + 40 * scaleX;
    const plotRight = sx + (curveW - 40) * scaleX;
    const above = cy < my;
    let top = above ? cy - 8 - tipH : cy + 8;
    if (above && top < 6) top = cy + 8;
    if (!above && top + tipH > wrap.height - 6) top = cy - 8 - tipH;
    let left = cx;
    if (left + tipW > plotRight) left = cx - tipW;
    left = Math.max(plotLeft, Math.min(left, plotRight - tipW));
    return { top, left };
  })();

  return (
    <>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${curveW} 220`}
        width="100%"
        height="220"
        preserveAspectRatio="none"
        role="img"
        aria-label="频响曲线"
        style={{
          cursor:
            'url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 12 12\'><g stroke=\'%23000\' stroke-width=\'1.8\'><path d=\'M6 0v3M6 9v3M0 6h3M9 6h3\'/></g><g stroke=\'%23fff\' stroke-width=\'0.8\'><path d=\'M6 0v3M6 9v3M0 6h3M9 6h3\'/></g></svg>") 6 6, crosshair',
        }}
        onMouseMove={onSvgMove}
        onMouseLeave={() => setHoverPt(null)}
      >
        {yGrid.map(({ db, y }) => (
          <line
            key={`y${db}`}
            x1="40"
            y1={y}
            x2={curveW - 40}
            y2={y}
            stroke="var(--border)"
            strokeWidth="1"
            strokeDasharray="4 4"
          />
        ))}
        {xGrid.map((x, i) => (
          <line
            key={`x${i}`}
            x1={x}
            y1={plotTop}
            x2={x}
            y2={plotBottom}
            stroke="var(--border)"
            strokeWidth="1"
            strokeDasharray="4 4"
          />
        ))}
        <line x1="40" y1={plotTop} x2="40" y2={plotBottom} stroke="var(--border-strong)" strokeWidth="1.5" />
        <line x1="40" y1={plotBottom} x2={curveW - 40} y2={plotBottom} stroke="var(--border-strong)" strokeWidth="1.5" />
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
        <g fill="var(--text-secondary)" fontSize="10">
          {xLabels.map((f, i) => (
            <text key={f} x={xGrid[i]} y={plotBottom + 12} textAnchor="middle">{f}</text>
          ))}
          {yGrid.map(({ db, y }) => (
            <text key={`l${db}`} x="34" y={y + 3} textAnchor="end">{db >= 0 ? `+${db}` : `${db}`}</text>
          ))}
        </g>
      </svg>
      {hoverPt && tipPos && (
        <div className="curve-tip" ref={tipRef} style={{ left: tipPos.left, top: tipPos.top }}>
          <span>{fmtFreq(hoverPt.f)}</span>
          <span className="tip-gain">{fmtDb(hoverPt.db)}</span>
        </div>
      )}
    </>
  );
}
