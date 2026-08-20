import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Block, ViewMode } from "../lib/model";
import { channelLabel } from "../lib/channels";
import { snapPx } from "../lib/snap";
import { t } from "../lib/i18n";

interface UseMarqueeSelectionOptions {
  bodyRef: React.RefObject<HTMLDivElement | null>;
  /** 事件期读取（框选启动门槛），由视图 hook 逐渲染更新。 */
  viewAnimatingRef: React.MutableRefObject<boolean>;
  viewRef: React.MutableRefObject<ViewMode>;
  blocks: Block[];
  setBlocks: React.Dispatch<React.SetStateAction<Block[]>>;
  markDirty: () => void;
  channelOn: boolean;
  channelBandCounts: Record<string, number>;
  notify: (msg: string) => void;
  setActiveChannel: (ch: string) => void;
  /** 视图动画期间工具栏隐藏标志（视图 hook 持有）。 */
  toolbarHidden: boolean;
}

/** 框选（marquee）、选中态、复制/删除与选中工具栏几何。 */
export function useMarqueeSelection({
  bodyRef,
  viewAnimatingRef,
  viewRef,
  blocks,
  setBlocks,
  markDirty,
  channelOn,
  channelBandCounts,
  notify,
  setActiveChannel,
  toolbarHidden,
}: UseMarqueeSelectionOptions) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [copyOpen, setCopyOpen] = useState(false);
  const [marquee, setMarquee] = useState<{
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  } | null>(null);
  const [selGeom, setSelGeom] = useState<{
    cx: number;
    minY: number;
    maxY: number;
    bodyW: number;
    bodyH: number;
  } | null>(null);
  // 几何就绪门闩：视图切换后置 false，必须等几何按当前视图重测完成才允许
  // 浮窗出现，避免浮窗带着旧/兜底几何先挂载、再飞过去（淡入时机随机）。
  const [selGeomReady, setSelGeomReady] = useState(true);
  const selGeomViewRef = useRef<string | null>(null);
  if (selGeomViewRef.current !== viewRef.current) {
    selGeomViewRef.current = viewRef.current;
    setSelGeomReady(false);
  }
  const [selGeomTick, setSelGeomTick] = useState(0);
  const marqueeStartRef = useRef<{ x: number; y: number } | null>(null);
  const marqueeRafRef = useRef(0);
  const pendingMarqueeRef = useRef<{
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  } | null>(null);
  const toolbarElRef = useRef<HTMLDivElement | null>(null);
  const [toolbarH, setToolbarH] = useState(64);
  const [toolbarW, setToolbarW] = useState(280);
  const toolbarAnimRef = useRef<{
    raf: number;
    start: { x: number; y: number };
    ctrl: { x: number; y: number };
    to: { x: number; y: number };
    t0: number;
  } | null>(null);

  // 框选过期清理：blocks 变化后移除已不存在的 id
  useEffect(() => {
    setSelectedIds((prev) => prev.filter((id) => blocks.some((b) => b.id === id)));
  }, [blocks]);

  useEffect(() => () => window.cancelAnimationFrame(marqueeRafRef.current), []);

  const onBodyPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if (viewAnimatingRef.current) return; // 视图切换动画期间不启动框选，避免命中到移动中的卡片
    const t = e.target;
    if (!(t instanceof Element)) return;
    if (t.closest("[data-dnd-id], button, input, select, .bottom-row, .gs-root, [role='slider']")) return;
    const body = bodyRef.current;
    if (!body) return;
    // Portal（下拉选项等）不在滚动容器的 DOM 树内，不能从这里开始框选/捕获指针，
    // 否则会把下拉选项的 pointerup 吸走，导致选项点不中
    if (!body.contains(t)) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* 捕获失败继续走元素事件 */
    }
    const rect = body.getBoundingClientRect();
    // marquee/toolbar 是 .tuning-scroll 的绝对定位子元素，会随内容滚动，
    // 因此坐标必须换算到滚动内容坐标系（可视坐标 + scrollTop/Left）。
    const x = e.clientX - rect.left + body.scrollLeft;
    const y = e.clientY - rect.top + body.scrollTop;
    window.cancelAnimationFrame(marqueeRafRef.current);
    marqueeRafRef.current = 0;
    pendingMarqueeRef.current = null;
    marqueeStartRef.current = { x, y };
    setMarquee({ x1: x, y1: y, x2: x, y2: y });
  };

  const onBodyPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = marqueeStartRef.current;
    const body = bodyRef.current;
    if (!s || !body) return;
    const rect = body.getBoundingClientRect();
    const x = e.clientX - rect.left + body.scrollLeft;
    const y = e.clientY - rect.top + body.scrollTop;
    pendingMarqueeRef.current = { x1: s.x, y1: s.y, x2: x, y2: y };
    if (!marqueeRafRef.current) {
      marqueeRafRef.current = requestAnimationFrame(() => {
        marqueeRafRef.current = 0;
        const m = pendingMarqueeRef.current;
        if (m) setMarquee(m);
      });
    }
  };

  const onBodyPointerUp = () => {
    window.cancelAnimationFrame(marqueeRafRef.current);
    marqueeRafRef.current = 0;
    const s = marqueeStartRef.current;
    const body = bodyRef.current;
    // pendingMarqueeRef 在 pointermove 里同步写入最新坐标且只在抬手时清空，
    // 避免 rAF 提交 setMarquee 的窗口期里读到零尺寸旧值，把拖拽误判成点空白清空选择。
    const m = pendingMarqueeRef.current ?? marquee;
    pendingMarqueeRef.current = null;
    marqueeStartRef.current = null;
    setMarquee(null);
    if (!s || !body || !m) return;
    const rect = body.getBoundingClientRect();
    // 把内容坐标系换算回可视坐标再求交：拖动期间若 scrollTop/Left 被布局变化
    // （视图收窄、滚动条出现/消失等）钳制，内容坐标会整体漂移，导致命中为空。
    // 卡片矩形同样要换算成容器内可视坐标（减去容器自身在视口中的偏移）。
    const x1 = Math.min(m.x1, m.x2) - body.scrollLeft;
    const x2 = Math.max(m.x1, m.x2) - body.scrollLeft;
    const y1 = Math.min(m.y1, m.y2) - body.scrollTop;
    const y2 = Math.max(m.y1, m.y2) - body.scrollTop;
    if (x2 - x1 < 4 && y2 - y1 < 4) {
      // 点空白：清空选择
      setSelectedIds([]);
      return;
    }
    const ids: string[] = [];
    body.querySelectorAll<HTMLElement>("[data-dnd-id]").forEach((el) => {
      if (el.dataset.dndGroup === "effects") return;
      const r = el.getBoundingClientRect();
      const rx = r.left - rect.left;
      const ry = r.top - rect.top;
      if (rx < x2 && rx + r.width > x1 && ry < y2 && ry + r.height > y1) {
        const id = el.dataset.dndId;
        if (id) ids.push(id);
      }
    });
    setSelectedIds(ids);
  };

  const deleteSelectedCards = useCallback(() => {
    const ids = selectedIds;
    if (!ids.length) return;
    markDirty();
    setBlocks((prev) => prev.filter((b) => !ids.includes(b.id ?? "")));
    setSelectedIds([]);
  }, [selectedIds, markDirty]);

  const copySelectedToChannel = useCallback(
    (ch: string) => {
      const ids = selectedIds;
      if (!ids.length || !channelOn) return;
      const count = ids.length;
      if ((channelBandCounts[ch] ?? 0) + count > 31) {
        notify(t("notify.copyLimit", { count }));
        return;
      }
      markDirty();
      setBlocks((prev) => [
        ...prev,
        ...prev
          .filter((b) => ids.includes(b.id ?? ""))
          .map((b) => ({
            ...b,
            id: crypto.randomUUID(),
            group: undefined,
            channel: ch,
          })),
      ]);
      setSelectedIds([]);
      setActiveChannel(ch);
      setCopyOpen(false);
      notify(t("notify.copied", { count, ch: channelLabel(ch) }));
    },
    [selectedIds, channelOn, channelBandCounts, markDirty, notify, setActiveChannel],
  );

  useEffect(() => {
    if (!copyOpen) return;
    const close = (e: PointerEvent) => {
      const t = e.target;
      if (t instanceof Element && t.closest(".sel-copy")) return;
      setCopyOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [copyOpen]);

  // 滚动时实时重测选中卡片几何，避免浮窗与卡片脱节。
  useEffect(() => {
    if (selectedIds.length === 0) return;
    const body = bodyRef.current;
    if (!body) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        setSelGeomTick((v) => v + 1);
      });
    };
    body.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      body.removeEventListener("scroll", onScroll);
      if (raf) window.cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds.length > 0]);

  // 工具栏高度变化（如复制到声道菜单展开）时重新避让，避免被顶部/底部裁剪
  useLayoutEffect(() => {
    const el = toolbarElRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect.height;
      const w = entries[0]?.contentRect.width;
      if (h && h > 0) setToolbarH((prev) => (prev === h ? prev : h));
      if (w && w > 0) setToolbarW((prev) => (prev === w ? prev : w));
    });
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds.length > 0]);

  // 选中工具栏几何：按选中卡片包围盒宽度取水平中心，下边距按网格行高动态计算
  useEffect(() => {
    const body = bodyRef.current;
    if (!body || selectedIds.length === 0) {
      setSelGeom(null);
      setSelGeomReady(true);
      return;
    }
    const rect = body.getBoundingClientRect();
    const contentH = body.scrollHeight;
    // 视图切换时 AnimatePresence 可能同时保留退场/进场两个 view-stage；
    // 必须只在当前 view-stage 内测量，否则会量到退场卡片的位置。
    const stage = body.querySelector<HTMLElement>(`[data-view="${viewRef.current}"]`);
    const els = stage
      ? selectedIds
          .map((id) => stage.querySelector<HTMLElement>(`[data-dnd-id="${id}"]`))
          .filter((el): el is HTMLElement => !!el)
      : [];
    if (!els.length) {
      // 视图切换/通道过滤动画期间选中卡片可能暂不可见：先给一个可见的默认几何，
      // 动画结束后的延迟重测会把浮窗移到正确位置，避免 selGeom 为 null 导致浮窗不显示
      setSelGeom({
        cx: rect.width / 2 + body.scrollLeft,
        minY: Math.round(rect.height * 0.3 + body.scrollTop),
        maxY: Math.round(rect.height * 0.35 + body.scrollTop),
        bodyW: rect.width,
        bodyH: contentH,
      });
      setSelGeomReady(true);
      return;
    }
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const el of els) {
      const r = el.getBoundingClientRect();
      const x = r.left - rect.left + body.scrollLeft;
      const y = r.top - rect.top + body.scrollTop;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x + r.width);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y + r.height);
    }
    setSelGeom({
      cx: (minX + maxX) / 2,
      minY,
      maxY,
      bodyW: rect.width,
      bodyH: contentH,
    });
    setSelGeomReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds, blocks, selGeomTick]);

  // 工具栏目标位置（选中范围变化后用于飞行）
  const toolbarTarget = useMemo(() => {
    if (!selGeom) return null;
    const gap = 10;
    const x = snapPx(
      Math.max(
        8 + toolbarW / 2,
        Math.min(selGeom.cx, selGeom.bodyW - 8 - toolbarW / 2),
      ),
    );
    // 优先放在选中卡片下方；下方空间不足则放到上方，确保不覆盖选中范围且不超出容器
    const belowY = selGeom.maxY + gap;
    const aboveY = selGeom.minY - toolbarH - gap;
    const rawY = belowY + toolbarH + 8 <= selGeom.bodyH ? belowY : aboveY;
    const y = snapPx(Math.max(8, Math.min(rawY, selGeom.bodyH - toolbarH - 8)));
    return { x, y };
  }, [selGeom, toolbarH, toolbarW]);

  // 位移动画沿用卡片飞行的二次贝塞尔：控制点水平偏移、先快后慢
  useLayoutEffect(() => {
    const el = toolbarElRef.current;
    if (!el || !toolbarTarget) {
      // Target gone / element unmounted: stop flight and clear stale state,
      // otherwise the next mount inherits an exit/fly state.
      if (toolbarAnimRef.current) {
        cancelAnimationFrame(toolbarAnimRef.current.raf);
        toolbarAnimRef.current = null;
      }
      return;
    }
    const cur = toolbarAnimRef.current;
    if (cur) cancelAnimationFrame(cur.raf);
    const start = {
      x: parseFloat(el.style.left) || toolbarTarget.x,
      y: parseFloat(el.style.top) || toolbarTarget.y,
    };
    // 首次出现直接就位，之后变化沿贝塞尔弧线移动
    if (start.x === toolbarTarget.x && start.y === toolbarTarget.y && !el.dataset.moved) {
      el.style.left = `${toolbarTarget.x}px`;
      el.style.top = `${toolbarTarget.y}px`;
      el.dataset.moved = "1";
      return;
    }
    const dx = toolbarTarget.x - start.x;
    const dy = toolbarTarget.y - start.y;
    const len = Math.hypot(dx, dy) || 1;
    // 垂直主导的移动走直线；水平主导才保留左右开度的弧线
    const ctrl =
      Math.abs(dy) > Math.abs(dx)
        ? { x: (start.x + toolbarTarget.x) / 2, y: (start.y + toolbarTarget.y) / 2 }
        : {
            x: start.x + (dx < 0 ? -1 : 1) * Math.min(220, len * 0.4),
            y: start.y,
          };
    const t0 = performance.now();
    const step = () => {
      const node = toolbarElRef.current;
      const anim = toolbarAnimRef.current;
      if (!node) {
        // Toolbar unmounted mid-flight: cancel remaining frames and clear
        // stale state so the next mount starts from a clean first frame.
        toolbarAnimRef.current = null;
        return;
      }
      if (!anim) return;
      const t = Math.min(1, (performance.now() - anim.t0) / 400);
      const k = 1 - Math.pow(1 - t, 4);
      const inv = 1 - k;
      const x = inv * inv * anim.start.x + 2 * inv * k * anim.ctrl.x + k * k * anim.to.x;
      const y = inv * inv * anim.start.y + 2 * inv * k * anim.ctrl.y + k * k * anim.to.y;
      node.style.left = `${snapPx(x)}px`;
      node.style.top = `${snapPx(y)}px`;
      if (t < 1) {
        anim.raf = requestAnimationFrame(step);
      } else {
        toolbarAnimRef.current = null;
        node.style.left = `${anim.to.x}px`;
        node.style.top = `${anim.to.y}px`;
      }
    };
    toolbarAnimRef.current = { raf: requestAnimationFrame(step), start, ctrl, to: toolbarTarget, t0 };
  }, [toolbarTarget, toolbarHidden]);

  useEffect(
    () => () => {
      if (toolbarAnimRef.current) cancelAnimationFrame(toolbarAnimRef.current.raf);
      toolbarAnimRef.current = null;
    },
    [],
  );

  return {
    selectedIds,
    setSelectedIds,
    copyOpen,
    setCopyOpen,
    marquee,
    selGeom,
    selGeomReady,
    selGeomTick,
    onBodyPointerDown,
    onBodyPointerMove,
    onBodyPointerUp,
    deleteSelectedCards,
    copySelectedToChannel,
    toolbarElRef,
    toolbarH,
    toolbarW,
    toolbarTarget,
    cancelToolbarAnim: () => {
      if (toolbarAnimRef.current) {
        cancelAnimationFrame(toolbarAnimRef.current.raf);
        toolbarAnimRef.current = null;
      }
    },
    bumpSelGeomTick: () => setSelGeomTick((v) => v + 1),
  };
}
