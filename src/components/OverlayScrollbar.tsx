import { memo, useEffect, useRef, useState, type PointerEvent, type RefObject } from "react";
import { createPortal } from "react-dom";
import { collapseEase } from "../lib/viewMotion";

/** 滚动停止多久后开始淡出（ms）。 */
const IDLE_FADE_MS = 1200;
/** 一次变化信号后继续逐帧核对几何的时长（ms）：覆盖进出场高度动画。静止后不再有任何 rAF。 */
const SETTLE_MS = 1100;

interface OverlayScrollbarProps {
  targetRef: RefObject<HTMLElement | null>;
  /** 可选：显式传入当前容器节点。设备切换时容器会重挂载，
   *  传节点让监听/几何跟随节点变化，滚动条组件本身不卸载。 */
  target?: HTMLElement | null;
  /** 设备切换键：变化时先淡出，避免页面重挂载导致滚动条硬消失。 */
  deviceKey?: string | number;
  /** 是否需要圆角避让（轨道上下内缩）；侧边栏/标签页内用，其余不需要。 */
  rounded?: boolean;
  /** 轨道右缘相对容器右缘的偏移（CSS right 值，px），默认 -2 贴边。 */
  rightPx?: number;
  /** 圆头右缘相对轨道的偏移（px），默认 -2 贴边；安装/保存预设用 -6。 */
  thumbRight?: number;
  /** 底部避让（px，圆角用）；默认跟随 rounded（26），否则 2。 */
  bottomInset?: number;
  /** 图层层级：非对话框默认 50（低于遮罩 60）；对话框内用 65（高于内容 61）。 */
  zIndex?: number;
  /**
   * 视图切换时的「长度变形」指令：token 变化即从**当前显示几何**插值到突跳后的真实几何。
   * 只用于变高方向——那一边内容高度是瞬时的，长度会硬跳（变矮方向由收窄动画逐帧带动）。
   */
  morph?: { token: number; ms: number } | null;
}

/** 自绘 overlay 滚动条：隐藏原生滚动条，由 JS 同步位置；
 *  有视觉宽度但不占页面布局宽度；滚动时显示、停止滚动自动淡出。 */
function OverlayScrollbar({
  targetRef,
  target,
  deviceKey,
  rounded = false,
  rightPx = -2,
  thumbRight = -2,
  bottomInset,
  zIndex = 50,
  morph,
}: OverlayScrollbarProps) {
  const [bar, setBar] = useState({
    visible: false,
    active: false,
    offset: 0,
    thumbH: 0,
    top: 0,
    left: 0,
    trackH: 24,
  });
  const dragRef = useRef<{ startY: number; startTop: number } | null>(null);
  const idleTimerRef = useRef(0);
  const prevDeviceKeyRef = useRef<unknown>(undefined);
  /** 变形中的显示几何（渲染优先用它，变形结束回落到真实几何） */
  const [morphView, setMorphView] = useState<{ thumbH: number; offset: number } | null>(
    null,
  );
  /** 最近一次算出的**真实**几何（update 里写，插值读） */
  const realRef = useRef({ thumbH: 0, offset: 0, ok: false });
  /** 最近一次**显示**的几何——变形的起点 */
  const dispRef = useRef({ thumbH: 0, offset: 0 });
  const morphRef = useRef<{
    start: number;
    ms: number;
    from: { thumbH: number; offset: number };
    to: { thumbH: number; offset: number } | null;
  } | null>(null);
  const lastMorphTokenRef = useRef<number | null>(null);
  /** 用 ref 读最新指令：监听 effect 的依赖不含 morph，闭包里会拿到旧值 */
  const morphSpecRef = useRef(morph);
  morphSpecRef.current = morph;

  /** 用户开始主动滚动/拖拽时立刻放弃变形，让滑块严格跟手。 */
  const cancelMorph = () => {
    if (!morphRef.current) return;
    morphRef.current = null;
    setMorphView(null);
  };

  /** 显示并安排停止滚动后自动淡出。 */
  const show = () => {
    cancelMorph();
    window.clearTimeout(idleTimerRef.current);
    idleTimerRef.current = window.setTimeout(() => {
      setBar((b) => (b.active ? { ...b, active: false } : b));
    }, IDLE_FADE_MS);
    setBar((b) => (b.active ? b : { ...b, visible: true, active: true }));
  };
  /** 仅淡出，不改变几何状态。 */
  const hide = () => {
    window.clearTimeout(idleTimerRef.current);
    setBar((b) => (b.active ? { ...b, active: false } : b));
  };

  useEffect(() => {
    const el = target ?? targetRef.current;
    if (!el) return;

    // 这两个是 rAF 跟随窗口的状态。必须**提前声明**：update() 在下面会同步先跑一次，
    // 而「变形」那一步会立刻调 settle()，此时若 let 还没执行到，就会撞 TDZ
    // （Cannot access 'x' before initialization → React 抛错卸载整棵树、界面变空白）。
    let raf = 0;
    let settleUntil = 0;

    const update = () => {
      const { scrollTop, clientHeight, scrollHeight } = el;
      const max = scrollHeight - clientHeight;
      // 视图切换派来的长度变形：token 变化就开一次。起点取「当前显示几何」，
      // 终点由紧随其后的真实几何给出（见 stepMorph），所以必须在算新几何之前读。
      const spec = morphSpecRef.current;
      if (spec && spec.token !== lastMorphTokenRef.current) {
        lastMorphTokenRef.current = spec.token;
        // 组件刚挂载时显示几何还是 0（例如换语言导致重挂载）：没有可插值的起点，
        // 直接对齐真实几何，别从 0 长度演一遍变形。
        if (dispRef.current.thumbH > 0) {
          morphRef.current = {
            start: performance.now(),
            ms: Math.max(1, spec.ms),
            from: { ...dispRef.current },
            to: null,
          };
          settle();
        }
      }
      // Portal 到 body 用 fixed：轨道按容器在视口中的实际位置钉死，
      // 不随任何滚动/transform 祖先移动。
      const rect = el.getBoundingClientRect();
      const topInset = rounded ? 24 : 2;
      const bottom = bottomInset ?? (rounded ? 26 : 2);
      const top = rect.top + topInset;
      const trackH = Math.max(24, rect.height - topInset - bottom);
      const left = rect.right + rightPx - 5;
      if (max <= 0) {
        // 不可滚时把 active 一起清掉：否则淡出动画期间一旦内容又变可滚
        // （视图切换/高度收窄），visible 恢复后 `.on` 会被重新加回，造成重入。
        window.clearTimeout(idleTimerRef.current);
        realRef.current = { thumbH: 0, offset: 0, ok: false };
        cancelMorph();
        setBar((b) =>
          b.visible || b.active || Math.abs(b.top - top) > 0.5 || Math.abs(b.left - left) > 0.5 || b.trackH !== trackH
            ? { ...b, visible: false, active: false, top, left, trackH }
            : b,
        );
        return;
      }
      const thumbH = Math.max(24, Math.min(trackH, (trackH / scrollHeight) * trackH));
      const travel = trackH - thumbH;
      const offset = (scrollTop / max) * travel;
      realRef.current = { thumbH, offset, ok: true };
      setBar((b) =>
        b.visible &&
        Math.abs(b.offset - offset) < 0.01 &&
        Math.abs(b.thumbH - thumbH) < 0.01 &&
        Math.abs(b.trackH - trackH) < 0.5 &&
        Math.abs(b.top - top) < 0.5 &&
        Math.abs(b.left - left) < 0.5
          ? b
          : { ...b, visible: true, offset, thumbH, top, left, trackH },
      );
    };

    update();
    // 只响应真实用户滚动（滚轮/触摸）来激活；视图切换等程序性滚动
    // 只更新几何、不激活，避免淡出过程中被重新呼出。
    const onScroll = () => {
      update();
      settle();
    };
    const onUserScroll = () => {
      update();
      show();
      settle();
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("wheel", onUserScroll, { passive: true });
    el.addEventListener("touchmove", onUserScroll, { passive: true });
    const ro = new ResizeObserver(settle);
    ro.observe(el);
    // 容器自身位置会随上方内容高度变化而整体位移：观察祖先链，保证轨道不脱节。
    for (let p = el.parentElement; p; p = p.parentElement) ro.observe(p);
    // 内容高度变化（进出场动画、列表增删）不一定改变容器尺寸：用结构/样式变化唤起
    // 一段有限的 rAF 跟随窗口，动画期间逐帧核对，静止后立刻回到零开销。
    const mo = new MutationObserver(settle);
    mo.observe(el, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["style", "class"],
    });
    /**
     * 推进长度变形。真实几何在 update 里算好，这里只做显示插值：
     * 目标一旦还在移动（不是「布局提交瞬间的突跳」，例如收窄动画逐帧推进）就放弃变形，
     * 免得插值去追一个持续变化的目标，反而比不做还难看。
     */
    // 注意：stepMorph / tick / settle 一律用函数声明（会提升），
    // 这样即使 settle() 在声明语句之前被调用也拿得到。
    function stepMorph(now: number): boolean {
      const m = morphRef.current;
      if (!m) return false;
      const real = realRef.current;
      if (!real.ok) {
        morphRef.current = null;
        setMorphView(null);
        return false;
      }
      if (!m.to) {
        m.to = { thumbH: real.thumbH, offset: real.offset };
      } else if (
        Math.abs(m.to.thumbH - real.thumbH) > 1 ||
        Math.abs(m.to.offset - real.offset) > 1
      ) {
        morphRef.current = null;
        setMorphView(null);
        return false;
      }
      const p = Math.min(1, (now - m.start) / m.ms);
      if (p >= 1) {
        // 收尾即归还真实几何：插值终点与真实值一致，不会跳
        morphRef.current = null;
        setMorphView(null);
        return false;
      }
      const e = collapseEase(p);
      setMorphView({
        thumbH: m.from.thumbH + (m.to.thumbH - m.from.thumbH) * e,
        offset: m.from.offset + (m.to.offset - m.from.offset) * e,
      });
      return true;
    }
    function tick() {
      raf = 0;
      update();
      const now = performance.now();
      const morphing = stepMorph(now);
      if (morphing || now < settleUntil) raf = requestAnimationFrame(tick);
    }
    function settle() {
      settleUntil = performance.now() + SETTLE_MS;
      if (!raf) raf = requestAnimationFrame(tick);
    }
    return () => {
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("wheel", onUserScroll);
      el.removeEventListener("touchmove", onUserScroll);
      ro.disconnect();
      mo.disconnect();
      cancelAnimationFrame(raf);
      window.clearTimeout(idleTimerRef.current);
    };
  }, [target, targetRef, rounded, rightPx, bottomInset]);

  // 设备切换：页面重挂载前先把滚动条淡出，避免硬消失。
  useEffect(() => {
    if (prevDeviceKeyRef.current === undefined) {
      prevDeviceKeyRef.current = deviceKey;
      return;
    }
    if (deviceKey !== prevDeviceKeyRef.current) {
      prevDeviceKeyRef.current = deviceKey;
      hide();
    }
  }, [deviceKey]);

  const onThumbPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const el = target ?? targetRef.current;
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { startY: e.clientY, startTop: el.scrollTop };
    show();
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onThumbPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const el = target ?? targetRef.current;
    const d = dragRef.current;
    if (!el || !d) return;
    const ratio = el.scrollHeight / el.clientHeight;
    el.scrollTop = d.startTop + (e.clientY - d.startY) * ratio;
  };

  const onThumbPointerEnd = (e: PointerEvent<HTMLDivElement>) => {
    dragRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* 未捕获时忽略 */
    }
  };

  // 变形期间显示插值几何，其余时间用真实几何；起点要记成「显示过的值」
  const disp = morphView ?? { thumbH: bar.thumbH, offset: bar.offset };
  dispRef.current = disp;

  return createPortal(
    <div
      className={`os-track${bar.visible && bar.active ? " on" : ""}`}
      style={{ top: bar.top, left: bar.left, height: bar.trackH, zIndex }}
      aria-hidden="true"
    >
      <div
        className="os-thumb"
        style={{
          height: disp.thumbH,
          transform: `translateY(${disp.offset}px)`,
          right: thumbRight,
        }}
        onPointerDown={onThumbPointerDown}
        onPointerMove={onThumbPointerMove}
        onPointerUp={onThumbPointerEnd}
        onPointerCancel={onThumbPointerEnd}
      />
    </div>,
    document.body,
  );
}

export default memo(OverlayScrollbar);
