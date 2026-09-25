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
  /** 上一次的**目标**路径。不能靠 getComputedStyle 拿旧值：layout 阶段 React 已经写入新 d 了 */
  const prevDRef = useRef<string | null>(null);
  // 用 layout effect：必须在浏览器绘制**之前**接管，否则新 d 会先画一帧再被动画拉回去（闪一下）
  useLayoutEffect(() => {
    const el = pathRef.current;
    if (!el) return;
    /**
     * 曲线自己变自己的形状：只要路径变了就平滑补间过去，不区分场景——切声道、开关/增删滤波器、
     * 拖频段参数、切设备全走这一条路，调用方不必再特判「该不该动画」。
     *
     * 补间全程在**像素空间**做，不换算 dB↔量程、也不夹边界。曲线和坐标轴是两件独立的事：
     * 纵轴量程（按峰值自适应、每 2dB 一档）该瞬时变就瞬时变，网格由 React 直接重画；
     * 曲线只管从「旧形状所在的屏幕位置」平滑过渡到「新形状所在的屏幕位置」。
     * 起点与终点本来就都在绘图区内，插值自然也落在区内——一旦改成"先按量程换算再钳位"，
     * 量程收窄时旧形状换算后必然越界，会被压在顶边（或底边）成一段直线再变回曲线，观感极差（踩过）。
     */
    /**
     * 起点取「上一条动画的当前位置」：先 `commitStyles()` 把动画当前值定格进内联样式，再取消。
     * 这样变形途中目标又变时会从当前位置接着跑，不会跳回旧值（连续拖动＝指数式平滑跟随）。
     * 没有在跑的动画时退回「上一个目标」——**不能**读 `getComputedStyle(el).d`，
     * 那时 React 已写入新 d，拿到的是新值本身，补间会退化成「新值→新值」＝完全看不到动画。
     */
    let from: string | null = null;
    const prevAnim = morphAnimRef.current;
    if (prevAnim) {
      try {
        prevAnim.commitStyles();
        from = el.style.d || null;
      } catch {
        from = null;
      }
      prevAnim.cancel();
      morphAnimRef.current = null;
      el.style.removeProperty("d");
    }
    if (!from) from = prevDRef.current;
    prevDRef.current = curveD;
    if (!from || from === curveD) return;

    const pair = alignPaths(from, curveD);
    if (!pair) return;
    const anim = el.animate([{ d: pair[0] }, { d: pair[1] }], {
      // 320ms 与 curve.css 里 stroke 过渡的 0.32s 对齐；不设 fill，结束后回到 React 写的 d
      duration: 320,
      easing: "cubic-bezier(0.4, 0, 0.2, 1)",
    });
    morphAnimRef.current = anim;
    // 结束（或被取消）时清掉 commitStyles 留下的内联 d，把控制权交回 React 的 attribute
    anim.finished
      .then(() => {
        if (morphAnimRef.current === anim) {
          morphAnimRef.current = null;
          el.style.removeProperty("d");
        }
      })
      .catch(() => {});
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
