import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import type { Block, PeqBandKind } from "../lib/model";
import { snapPx } from "../lib/snap";
import { t } from "../lib/i18n";

/** 跟随速度：每帧补足剩余距离的比例，越小越“黏” */
const FOLLOW_FACTOR = 0.08;
/** 基准点切换时的平移动画时长：满速跨过轴线，结束后无缝回到慢跟随 */
const FLIP_TRANSLATE_MS = 280;
/** 安全区半径：以曲线落点为圆心的圆，光标在圆内不切换基准侧 */
const SAFE_RADIUS = 10;

interface TipGeom {
  wrap: DOMRect;
  svg: DOMRect;
  tipW: number;
  tipH: number;
}

function easeOutQuart(x: number): number {
  return 1 - Math.pow(1 - x, 4);
}

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

function biquadDb(
  freq: number,
  fs: number,
  b0: number,
  b1: number,
  b2: number,
  a0: number,
  a1: number,
  a2: number,
): number {
  const f = Math.max(10, Math.min(fs * 0.49, freq));
  const w = (2 * Math.PI * f) / fs;
  const c = Math.cos(w);
  const s = Math.sin(w);
  const c2 = Math.cos(2 * w);
  const s2 = Math.sin(2 * w);
  const num = Math.hypot(b0 + b1 * c + b2 * c2, b1 * s + b2 * s2);
  const den = Math.hypot(a0 + a1 * c + a2 * c2, a1 * s + a2 * s2);
  return 20 * Math.log10(num / den);
}

function lowPassDb(freq: number, fc: number, q: number, fs: number): number {
  const center = Math.max(10, Math.min(fs * 0.49, fc));
  const qq = Math.max(0.1, Math.min(20, q));
  const w0 = (2 * Math.PI * center) / fs;
  const cw = Math.cos(w0);
  const sw = Math.sin(w0);
  const alpha = sw / (2 * qq);
  const b0 = (1 - cw) / 2;
  const b1 = 1 - cw;
  const b2 = (1 - cw) / 2;
  const a0 = 1 + alpha;
  const a1 = -2 * cw;
  const a2 = 1 - alpha;
  return biquadDb(freq, fs, b0, b1, b2, a0, a1, a2);
}

function highPassDb(freq: number, fc: number, q: number, fs: number): number {
  const center = Math.max(10, Math.min(fs * 0.49, fc));
  const qq = Math.max(0.1, Math.min(20, q));
  const w0 = (2 * Math.PI * center) / fs;
  const cw = Math.cos(w0);
  const sw = Math.sin(w0);
  const alpha = sw / (2 * qq);
  const b0 = (1 + cw) / 2;
  const b1 = -(1 + cw);
  const b2 = (1 + cw) / 2;
  const a0 = 1 + alpha;
  const a1 = -2 * cw;
  const a2 = 1 - alpha;
  return biquadDb(freq, fs, b0, b1, b2, a0, a1, a2);
}

function lowShelfDb(freq: number, fc: number, gainDb: number, q: number, fs: number): number {
  const center = Math.max(10, Math.min(fs * 0.49, fc));
  const qq = Math.max(0.1, Math.min(20, q));
  const A = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * center) / fs;
  const cw = Math.cos(w0);
  const sw = Math.sin(w0);
  const alpha = sw / (2 * qq);
  const sqrtA = Math.sqrt(A);
  const b0 = A * ((A + 1) - (A - 1) * cw + 2 * sqrtA * alpha);
  const b1 = 2 * A * ((A - 1) - (A + 1) * cw);
  const b2 = A * ((A + 1) - (A - 1) * cw - 2 * sqrtA * alpha);
  const a0 = (A + 1) + (A - 1) * cw + 2 * sqrtA * alpha;
  const a1 = -2 * ((A - 1) + (A + 1) * cw);
  const a2 = (A + 1) + (A - 1) * cw - 2 * sqrtA * alpha;
  return biquadDb(freq, fs, b0, b1, b2, a0, a1, a2);
}

function highShelfDb(freq: number, fc: number, gainDb: number, q: number, fs: number): number {
  const center = Math.max(10, Math.min(fs * 0.49, fc));
  const qq = Math.max(0.1, Math.min(20, q));
  const A = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * center) / fs;
  const cw = Math.cos(w0);
  const sw = Math.sin(w0);
  const alpha = sw / (2 * qq);
  const sqrtA = Math.sqrt(A);
  const b0 = A * ((A + 1) + (A - 1) * cw + 2 * sqrtA * alpha);
  const b1 = -2 * A * ((A - 1) + (A + 1) * cw);
  const b2 = A * ((A + 1) + (A - 1) * cw - 2 * sqrtA * alpha);
  const a0 = (A + 1) - (A - 1) * cw + 2 * sqrtA * alpha;
  const a1 = 2 * ((A - 1) - (A + 1) * cw);
  const a2 = (A + 1) - (A - 1) * cw - 2 * sqrtA * alpha;
  return biquadDb(freq, fs, b0, b1, b2, a0, a1, a2);
}

/** 按 band.kind 计算幅度响应（缺省 peaking），与 driver RBJ biquad 对齐。 */
export function bandDb(
  freq: number,
  band: { fc: number; gain_db: number; q: number; kind?: PeqBandKind },
  fs: number,
): number {
  switch (band.kind ?? "peaking") {
    case "low_shelf":
      return lowShelfDb(freq, band.fc, band.gain_db, band.q, fs);
    case "high_shelf":
      return highShelfDb(freq, band.fc, band.gain_db, band.q, fs);
    case "low_pass":
      return lowPassDb(freq, band.fc, band.q, fs);
    case "high_pass":
      return highPassDb(freq, band.fc, band.q, fs);
    case "peaking":
    default:
      return peakingDb(freq, band.fc, band.gain_db, band.q, fs);
  }
}

function dbY(db: number, top: number): number {
  return 24 + ((top - db) / (top + 16)) * 180;
}

function freqPath(blocks: Block[], fs: number, w: number, top: number, preampGainDb = 0): string {
  const pts: string[] = [];
  for (let i = 0; i <= 240; i++) {
    const f = 20 * Math.pow(1000, i / 240);
    let db = preampGainDb;
    for (const b of blocks) {
      if (!b.enabled) continue;
      for (const band of b.bands) db += bandDb(f, band, fs);
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
  preampGainDb?: number;
}

interface HoverPt {
  x: number;
  y: number;
  f: number;
  db: number;
  cvx: number;
  cvy: number;
}

function CurvePlot({ blocks, fs, curveW, yTop, preampGainDb = 0 }: CurvePlotProps) {
  const [hoverPt, setHoverPt] = useState<HoverPt | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const tipTargetRef = useRef<{ x: number; y: number } | null>(null);
  const tipPosRef = useRef<{ x: number; y: number } | null>(null);
  const tipRafRef = useRef<number | undefined>(undefined);
  const tipAnchorRef = useRef("");
  const flipRef = useRef<{ start: number; from: { x: number; y: number } } | null>(null);
  const geomRef = useRef<TipGeom | null>(null);

  const measureGeom = (): TipGeom | null => {
    const wrap = svgRef.current?.parentElement?.getBoundingClientRect();
    const svg = svgRef.current?.getBoundingClientRect();
    if (!wrap || !svg) return null;
    return {
      wrap,
      svg,
      tipW: tipRef.current?.offsetWidth ?? 96,
      tipH: tipRef.current?.offsetHeight ?? 40,
    };
  };

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
    () => freqPath(blocks, fs, curveW, yTop, preampGainDb),
    [blocks, fs, curveW, yTop, preampGainDb],
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
    let db = preampGainDb;
    for (const b of blocks) {
      if (!b.enabled) continue;
      for (const band of b.bands) db += bandDb(cl, band, fs);
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
    const g = geomRef.current ?? measureGeom();
    if (!g) return null;
    geomRef.current = g;
    const { wrap, svg, tipW, tipH } = g;
    const sx = svg.left - wrap.left;
    const sy = svg.top - wrap.top;
    const scaleX = svg.width / curveW;
    const scaleY = svg.height / 220;
    const cx = sx + hoverPt.cvx * scaleX;
    const cy = sy + hoverPt.cvy * scaleY;
    const plotLeft = sx + 40 * scaleX;
    const plotRight = sx + (curveW - 40) * scaleX;
    // 屏幕斜率：按悬浮窗宽度对应的曲线段计算平均斜率，
    // 不是实时差值，快慢移动行为一致（对数轴在 20k 附近特别陡）
    const fAtX = (x: number) => {
      const t = ((x - sx) / scaleX - 40) / (curveW - 80);
      return 20 * Math.pow(10, t * 3);
    };
    const dbAt = (f: number) => {
      const cl = Math.max(20, Math.min(20000, f));
      let db = preampGainDb;
      for (const b of blocks) {
        if (!b.enabled) continue;
        for (const band of b.bands) db += bandDb(cl, band, fs);
      }
      return Math.max(-16, Math.min(yTop, db));
    };
    const segW = tipW;
    const xA = Math.max(plotLeft, cx - segW / 2);
    const xB = Math.min(plotRight, cx + segW / 2);
    const yA = sy + dbY(dbAt(fAtX(xA)), yTop) * scaleY;
    const yB = sy + dbY(dbAt(fAtX(xB)), yTop) * scaleY;
    const slope = xB > xA ? (yB - yA) / (xB - xA) : 0;
    const my = sy + hoverPt.y * scaleY;
    const R = SAFE_RADIUS;
    const distY = cy - my;
    const inSafeZone = Math.abs(distY) <= R;
    const prevAbove = tipAnchorRef.current
      ? tipAnchorRef.current.startsWith("above")
      : null;
    let above: boolean;
    if (prevAbove === null) {
      above = distY < 0;
    } else if (inSafeZone) {
      above = prevAbove;
    } else {
      above = distY < 0;
    }
    // 垂直与水平独立补偿：
    // 垂直边距恒为 R（斜→平 不再缩水），水平 gH = R·|m| / √(1+m²) 随斜率增加
    const denom = Math.sqrt(1 + slope * slope);
    const gV = R;
    const gH = (R * Math.abs(slope)) / denom;
    // 水平避让：悬浮窗以左上角为基准，左右两侧都使用固定频率停止点。
    // 右侧最远停到 12 kHz（等效于 20k 线左侧的固定间距 + 悬浮窗宽度）；
    // 左侧有 Y 轴刻度留白，不需要避让到 20 Hz，停在 23 Hz 即可。
    const sign = slope >= 0 ? 1 : -1;
    const base = cx + sign * gH;
    const minLeft = sx + logX(23, curveW) * scaleX;
    const maxLeft = sx + logX(12000, curveW) * scaleX;
    const left = Math.max(minLeft, Math.min(base, maxLeft));
    let hSide: "left" | "center" | "right";
    if (base <= minLeft) {
      hSide = "left";
    } else if (base >= maxLeft) {
      hSide = "right";
    } else {
      hSide = "center";
    }
    const top = Math.max(
      6,
      Math.min(
        above ? Math.min(cy, my) - gV - tipH : Math.max(cy, my) + gV,
        wrap.height - 6 - tipH,
      ),
    );
    return { top, left, above, hSide };
  })();

  // 悬浮窗跟随动画：指数趋近，比鼠标慢半拍、先快后慢；
  // 基准点（上/下、左/右）切换时播一段满速 ease 平移，跨过轴线后回到慢跟随
  useLayoutEffect(() => {
    const el = tipRef.current;
    if (!hoverPt || !tipPos) {
      geomRef.current = null;
      tipTargetRef.current = null;
      if (tipRafRef.current != null) {
        cancelAnimationFrame(tipRafRef.current);
        tipRafRef.current = undefined;
      }
      return;
    }
    const target = { x: snapPx(tipPos.left), y: snapPx(tipPos.top) };
    tipTargetRef.current = target;
    const anchor = `${tipPos.above ? "above" : "below"}-${tipPos.hSide}`;
    if (anchor !== tipAnchorRef.current) {
      const prev = tipAnchorRef.current;
      tipAnchorRef.current = anchor;
      if (prev) {
        flipRef.current = {
          start: performance.now(),
          from: tipPosRef.current ?? target,
        };
      }
    }
    if (!tipPosRef.current && el) {
      geomRef.current = measureGeom();
      tipPosRef.current = target;
      el.style.transform = `translate(${target.x}px, ${target.y}px)`;
    }
    if (tipRafRef.current != null) return;
    const step = () => {
      const node = tipRef.current;
      const t = tipTargetRef.current;
      if (!node || !t) {
        tipRafRef.current = undefined;
        return;
      }
      const now = performance.now();
      const flip = flipRef.current;
      if (flip) {
        const p = Math.min(1, (now - flip.start) / FLIP_TRANSLATE_MS);
        const k = easeOutQuart(p);
        const posX = snapPx(flip.from.x + (t.x - flip.from.x) * k);
        const posY = snapPx(flip.from.y + (t.y - flip.from.y) * k);
        tipPosRef.current = { x: posX, y: posY };
        node.style.transform = `translate(${posX}px, ${posY}px)`;
        if (p >= 1) {
          flipRef.current = null;
          tipPosRef.current = { x: snapPx(t.x), y: snapPx(t.y) };
          node.style.transform = `translate(${snapPx(t.x)}px, ${snapPx(t.y)}px)`;
          tipRafRef.current = undefined;
          return;
        }
        tipRafRef.current = requestAnimationFrame(step);
        return;
      }
      const cur = tipPosRef.current ?? t;
      const nx = snapPx(cur.x + (t.x - cur.x) * FOLLOW_FACTOR);
      const ny = snapPx(cur.y + (t.y - cur.y) * FOLLOW_FACTOR);
      tipPosRef.current = { x: nx, y: ny };
      node.style.transform = `translate(${nx}px, ${ny}px)`;
      if (Math.abs(t.x - nx) < 0.4 && Math.abs(t.y - ny) < 0.4) {
        tipPosRef.current = { x: snapPx(t.x), y: snapPx(t.y) };
        node.style.transform = `translate(${snapPx(t.x)}px, ${snapPx(t.y)}px)`;
        tipRafRef.current = undefined;
        return;
      }
      tipRafRef.current = requestAnimationFrame(step);
    };
    tipRafRef.current = requestAnimationFrame(step);
  }, [hoverPt, tipPos]);

  useEffect(
    () => () => {
      if (tipRafRef.current != null) cancelAnimationFrame(tipRafRef.current);
    },
    [],
  );

  useEffect(() => {
    // 图表尺寸变化后重新测量，避免继续用旧几何
    geomRef.current = null;
  }, [curveW]);

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
