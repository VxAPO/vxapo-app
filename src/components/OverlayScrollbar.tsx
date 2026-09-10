import { memo, useEffect, useRef, useState, type PointerEvent, type RefObject } from "react";
import { createPortal } from "react-dom";

/** 滚动停止多久后淡出（ms）。 */
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

  /** 显示并安排停止滚动后自动淡出。 */
  const show = () => {
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

    const update = () => {
      const { scrollTop, clientHeight, scrollHeight } = el;
      const max = scrollHeight - clientHeight;
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
    let raf = 0;
    let settleUntil = 0;
    const tick = () => {
      raf = 0;
      update();
      if (performance.now() < settleUntil) raf = requestAnimationFrame(tick);
    };
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

  return createPortal(
    <div
      className={`os-track${bar.visible && bar.active ? " on" : ""}`}
      style={{ top: bar.top, left: bar.left, height: bar.trackH, zIndex }}
      aria-hidden="true"
    >
      <div
        className="os-thumb"
        style={{
          height: bar.thumbH,
          transform: `translateY(${bar.offset}px)`,
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
