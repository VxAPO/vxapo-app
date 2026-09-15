import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import type { Block } from "../lib/model";
import { snapPx } from "../lib/snap";
import { dbY, logX } from "../lib/curve";
import { bandDbCached } from "../lib/rbj";

/**
 * 跟随响应：**临界阻尼弹簧**，FOLLOW_SETTLE_MS 约等于"基本停稳"的时间。
 *
 * 为什么不用指数趋近（k = 1 - e^(-dt/τ)）：
 * - 指数尾巴极长（τ=280ms 时最后 1px 要爬 1s 以上），观感是"先快后极慢、非线形"；
 * - 弹簧带速度项，中段推进更快、停稳时间有界，且不会过冲。
 * 也不能用"每帧补足剩余距离的比例"：那与帧率强相关（本机 rAF ≈400Hz）。
 */
const FOLLOW_SETTLE_MS = 240;
/** 到位判定：位移与速度都足够小就直接贴上，省掉无意义的最后一帧帧微调 */
const FOLLOW_SNAP_PX = 0.5;
const FOLLOW_SNAP_V = 40; // px/s
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
  const geomRef = useRef<TipGeom | null>(null);
  /** 上一帧时间戳与当前速度：弹簧按真实 dt 积分 */
  const tipLastTsRef = useRef(0);
  const tipVelRef = useRef({ x: 0, y: 0 });

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

  const moveRafRef = useRef(0);
  const pendingPtRef = useRef<{ x: number; y: number } | null>(null);

  /** 采集与重算合并到一帧一次：pointermove 可以比帧更快，中间值从未被渲染过。 */
  const onSvgMove = (e: MouseEvent<SVGSVGElement>) => {
    pendingPtRef.current = { x: e.clientX, y: e.clientY };
    if (moveRafRef.current) return;
    moveRafRef.current = requestAnimationFrame(() => {
      moveRafRef.current = 0;
      const pt = pendingPtRef.current;
      pendingPtRef.current = null;
      const svg = svgRef.current;
      if (!pt || !svg) return;
      const svgRect = svg.getBoundingClientRect();
      const px = pt.x - svgRect.left;
      const py = pt.y - svgRect.top;
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
    });
  };

  // 悬浮窗几何只在 hover 点/曲线尺寸变化时算一次：原先每次渲染都要跑两遍全段求和
  const tipPos: TipPos | null = useMemo(() => {
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
  }, [hoverPt, curveW, blocks, fs, yTop, yBottom, preampGainDb]);

  // 悬浮窗跟随动画：指数趋近，比鼠标慢半拍、先快后慢；
  // 基准点（上/下、左/右）切换时播一段满速 ease 平移，跨过轴线后回到慢跟随
  useLayoutEffect(() => {
    const el = tipRef.current;
    if (!hoverPt || !tipPos) {
      geomRef.current = null;
      tipTargetRef.current = null;
      tipLastTsRef.current = 0;
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
      tipAnchorRef.current = anchor;
    }
    if (!tipPosRef.current && el) {
      geomRef.current = measureGeom();
      tipPosRef.current = target;
      tipVelRef.current = { x: 0, y: 0 };
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
      /**
       * 目标跳变（含极值处的避让夹紧、上下/左右基准切换）一律走同一条弹簧，
       * 不再有"满速平移"分支——那条分支会让极值附近的慢跟随直接被绕过。
       */
      const cur = tipPosRef.current ?? t;
      const prevTs = tipLastTsRef.current || now;
      const dt = Math.min(64, Math.max(0.5, now - prevTs));
      tipLastTsRef.current = now;
      // 临界阻尼：ω = 6.6 / T（T 内衰减到 1%），半隐式欧拉，分 2 子步保证稳定
      const omega = 6.6 / (FOLLOW_SETTLE_MS / 1000);
      const v = tipVelRef.current;
      let px = cur.x;
      let py = cur.y;
      const h = dt / 1000 / 2;
      for (let i = 0; i < 2; i++) {
        v.x += (-omega * omega * (px - t.x) - 2 * omega * v.x) * h;
        v.y += (-omega * omega * (py - t.y) - 2 * omega * v.y) * h;
        px += v.x * h;
        py += v.y * h;
      }
      const nx = snapPx(px);
      const ny = snapPx(py);
      tipPosRef.current = { x: nx, y: ny };
      node.style.transform = `translate(${nx}px, ${ny}px)`;
      if (
        Math.abs(t.x - nx) < FOLLOW_SNAP_PX &&
        Math.abs(t.y - ny) < FOLLOW_SNAP_PX &&
        Math.abs(v.x) < FOLLOW_SNAP_V &&
        Math.abs(v.y) < FOLLOW_SNAP_V
      ) {
        tipPosRef.current = { x: snapPx(t.x), y: snapPx(t.y) };
        tipVelRef.current = { x: 0, y: 0 };
        node.style.transform = `translate(${snapPx(t.x)}px, ${snapPx(t.y)}px)`;
        tipLastTsRef.current = 0;
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
      if (moveRafRef.current) cancelAnimationFrame(moveRafRef.current);
    },
    [],
  );

  /** 离开图表：丢弃这一帧尚未处理的移动，避免移出后悬浮点又跳回来一次。 */
  const onMouseLeave = useCallback(() => {
    if (moveRafRef.current) {
      cancelAnimationFrame(moveRafRef.current);
      moveRafRef.current = 0;
    }
    pendingPtRef.current = null;
    setHoverPt(null);
  }, []);

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
    onMouseLeave,
  };
}
