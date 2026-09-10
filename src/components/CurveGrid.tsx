import { memo, useMemo } from "react";
import { dbY, logX } from "../lib/curve";

interface CurveGridProps {
  curveW: number;
  yTop: number;
  yBottom: number;
}

/** 频响图坐标轴：虚线网格 + 实线主轴 + 刻度标签（Y 自适应，步长统一）。 */
function CurveGrid({ curveW, yTop, yBottom }: CurveGridProps) {
  const yStep = yTop - yBottom > 26 ? 4 : 2;
  const yGrid = useMemo(() => {
    const g: { db: number; y: number }[] = [];
    // 网格行统一落在步长整数倍：间距全程一致，0 是任意步长的倍数自然包含，
    // 不再出现“0 附近 2dB、其余 4dB”的混合刻度。
    const topRow = Math.floor(yTop / yStep) * yStep;
    const bottomRow = Math.ceil(yBottom / yStep) * yStep;
    for (let db = topRow; db >= bottomRow; db -= yStep) {
      g.push({ db, y: dbY(db, yTop, yBottom) });
    }
    return g;
  }, [yTop, yBottom, yStep]);
  const plotTop = dbY(yTop, yTop, yBottom);
  const plotBottom = dbY(yBottom, yTop, yBottom);
  const xGrid = useMemo(
    () => [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000].map((f) => logX(f, curveW)),
    [curveW],
  );
  const xLabels = ["20", "50", "100", "200", "500", "1k", "2k", "5k", "10k", "20k"];

  return (
    <>
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
      <line x1="40" y1={plotTop} x2="40" y2={plotBottom} stroke="var(--curve-axis)" strokeWidth="1.5" />
      <line x1="40" y1={plotBottom} x2={curveW - 40} y2={plotBottom} stroke="var(--curve-axis)" strokeWidth="1.5" />
      <g fill="var(--text-secondary)" fontSize="10">
        {xLabels.map((f, i) => (
          <text key={f} x={xGrid[i]} y={plotBottom + 12} textAnchor="middle">{f}</text>
        ))}
        {yGrid.map(({ db, y }) => (
          <text key={`l${db}`} x="34" y={y + 3} textAnchor="end">{db >= 0 ? `+${db}` : `${db}`}</text>
        ))}
      </g>
    </>
  );
}

export default memo(CurveGrid);
