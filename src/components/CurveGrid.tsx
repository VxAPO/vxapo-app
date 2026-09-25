import { memo, useMemo } from "react";
import { dbY, logX, yStepFor } from "../lib/curve";
import { snapPx } from "../lib/snap";

interface CurveGridProps {
  curveW: number;
  yTop: number;
  yBottom: number;
}

/** 频响图坐标轴：虚线网格 + 实线主轴 + 刻度标签（Y 自适应，步长统一）。 */
function CurveGrid({ curveW, yTop, yBottom }: CurveGridProps) {
  // 步长与 lib/curve.axisRange 同规则。量程已被它对齐到步长整数倍，所以网格能从 yTop 一路铺到
  // yBottom：首末两条正好压在绘图区上下沿，0dB 也必然落在某条线上。从前是在绘制侧用
  // floor/ceil 去凑步长整数倍，量程非倍数时首条会缩进来半格——虚线便贴不住纵轴顶端。
  const yStep = yStepFor(yTop, yBottom);
  const yGrid = useMemo(() => {
    const g: { db: number; y: number }[] = [];
    for (let db = yTop; db >= yBottom; db -= yStep) {
      // 行位置取整到设备像素：间距常带半像素（如 180×4/32 = 22.5px），不 snap 时文字落在
      // 亚像素上会被渲染器取整——看起来就是"刻度数字有概率往下偏"。
      g.push({ db, y: snapPx(dbY(db, yTop, yBottom)) });
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
          /* 用 dominantBaseline="middle" 让文字垂直中心正对网格行，不再依赖 `+3` 这类经验偏移 */
          <text key={`l${db}`} x="34" y={y} textAnchor="end" dominantBaseline="middle">{db >= 0 ? `+${db}` : `${db}`}</text>
        ))}
      </g>
    </>
  );
}

export default memo(CurveGrid);
