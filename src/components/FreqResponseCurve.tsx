import { useMemo } from "react";
import { frequencyResponse } from "../lib/config";
import type { Filter } from "../types";

interface FreqResponseCurveProps {
  filters: Filter[];
  width?: number;
  height?: number;
}

export default function FreqResponseCurve({ filters, width = 600, height = 220 }: FreqResponseCurveProps) {
  const points = useMemo(() => frequencyResponse(filters, 160), [filters]);
  const padL = 36;
  const padR = 12;
  const padT = 12;
  const padB = 20;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;
  const dbMin = -18;
  const dbMax = 18;
  const fMin = 20;
  const fMax = 20000;

  const x = (freq: number) => padL + (Math.log(freq / fMin) / Math.log(fMax / fMin)) * plotW;
  const y = (db: number) => padT + (1 - (Math.min(dbMax, Math.max(dbMin, db)) - dbMin) / (dbMax - dbMin)) * plotH;

  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(p.freq).toFixed(1)},${y(p.db).toFixed(1)}`).join(" ");
  const gridDb = [-12, -6, 0, 6, 12];
  const gridFreq = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {gridDb.map((db) => (
        <g key={db}>
          <line x1={padL} x2={width - padR} y1={y(db)} y2={y(db)} stroke="var(--border-subtle)" strokeWidth={1} />
          <text x={padL - 4} y={y(db) + 3} textAnchor="end" fontSize={10} fill="var(--text-tertiary)">
            {db > 0 ? `+${db}` : db}
          </text>
        </g>
      ))}
      {gridFreq.map((f) => (
        <g key={f}>
          <line x1={x(f)} x2={x(f)} y1={padT} y2={height - padB} stroke="var(--border-subtle)" strokeWidth={1} />
          <text x={x(f)} y={height - padB + 12} textAnchor="middle" fontSize={9} fill="var(--text-tertiary)">
            {f >= 1000 ? `${f / 1000}k` : f}
          </text>
        </g>
      ))}
      <path d={path} fill="none" stroke="var(--accent-green)" strokeWidth={2} />
      <rect x={padL} y={padT} width={plotW} height={plotH} fill="none" stroke="var(--border-default)" />
    </svg>
  );
}
