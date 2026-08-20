import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import type { Block } from "../lib/model";
import { snapPx } from "../lib/snap";
import { dbY, logX } from "../lib/curve";
import { bandDbCached } from "../lib/rbj";

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

interface HoverPt {
  x: number;
  y: number;
  f: number;
  db: number;
  cvx: number;
  cvy: number;
}

interface TipPos {
  top: number;
  left: number;
  above: boolean;
  hSide: "left" | "center" | "right";
}

function easeOutQuart(x: number): number {
  return 1 - Math.pow(1 - x, 4);
}

interface UseCurveHoverOptions {
  blocks: Block[];
  fs: number;
  curveW: number;
  yTop: number;
  yBottom: number;
  preampGainDb: number;
}

/** 曲线悬停点与悬浮卡：几何避让 + 基准切换平移 + 慢跟随动画。 */
export function useCurveHover({
  blocks,
  fs,
  curveW,
  yTop,
  yBottom,
  preampGainDb,
}: UseCurveHoverOptions) {
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
      for (const band of b.bands) db += bandDbCached(cl, band, fs);
    }
    const clamped = Math.max(yBottom, Math.min(yTop, db));
    setHoverPt({
      x,
      y: dbY(clamped, yTop, yBottom),
      f: cl,
      db,
      cvx: viewX,
      cvy: viewY,
    });
  };

  const tipPos: TipPos | null = (() => {
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
        for (const band of b.bands) db += bandDbCached(cl, band, fs);
      }
      return Math.max(yBottom, Math.min(yTop, db));
    };
    const segW = tipW;
    const xA = Math.max(plotLeft, cx - segW / 2);
    const xB = Math.min(plotRight, cx + segW / 2);
    const yA = sy + dbY(dbAt(fAtX(xA)), yTop, yBottom) * scaleY;
    const yB = sy + dbY(dbAt(fAtX(xB)), yTop, yBottom) * scaleY;
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

  return {
    hoverPt,
    tipPos,
    svgRef,
    tipRef,
    onSvgMove,
    onMouseLeave: () => setHoverPt(null),
  };
}
