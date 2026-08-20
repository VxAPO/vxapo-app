import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { snapPx } from "../lib/snap";

import {
  ANIM_SETTLE_BUFFER_MS,
  DragListeners,
  DragSession,
  ENTER_DEBOUNCE_MS,
  FLY_TOTAL_MS,
  FlyState,
  LAYOUT_ANIM_MS,
  LAYOUT_ANIM_OUTSIDE_MS,
  OUTSIDE_DIST,
  Slot,
  UseDragSortOptions,
} from "../lib/dragSortTypes";

export function useDragSort({ group, markDirty, overlayContent, commitOrder }: UseDragSortOptions) {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [dragSize, setDragSize] = useState<{ width: number; height: number } | null>(null);
  const [overlayNum, setOverlayNum] = useState(0);
  const [, setTick] = useState(0);
  const [fly, setFly] = useState<FlyState | null>(null);

  const overlayRef = useRef<HTMLDivElement | null>(null);
  const flyRef = useRef<FlyState | null>(null);
  const flyIdRef = useRef(0);
  const dragRef = useRef<DragSession | null>(null);
  const entryTimerRef = useRef<number | undefined>(undefined);
  const settleTimerRef = useRef<number | undefined>(undefined);
  const animEndRef = useRef(0);
  const pendingSlotRef = useRef<number | null>(null);
  const settlingRef = useRef(false);
  const dragTokenRef = useRef(0);
  const listenersRef = useRef<DragListeners | null>(null);
  const pointerDownRef = useRef(false);
  const flySafetyRef = useRef<number | undefined>(undefined);
  const overlayContentRef = useRef(overlayContent);
  overlayContentRef.current = overlayContent;
  const optionsRef = useRef({ markDirty, commitOrder });
  optionsRef.current = { markDirty, commitOrder };

  const revealDraggedCards = () => {
    // 兜底：无论 is-dragging 类是否被状态更新打断，落地动画期间原卡片内容都必须保持隐藏
    document
      .querySelectorAll<HTMLElement>("[data-fly-hidden]")
      .forEach((el) => el.removeAttribute("data-fly-hidden"));
  };

  const resetCardStyles = () => {
    document.querySelectorAll<HTMLElement>("[data-dnd-id]").forEach((el) => {
      // 清掉拖拽期间的内联过渡，恢复 CSS 的 hover 阴影淡入
      el.style.transition = "";
      el.style.transform = "none";
    });
    revealDraggedCards();
  };

  const removeListeners = () => {
    const l = listenersRef.current;
    if (!l) return;
    window.removeEventListener("pointermove", l.move);
    window.removeEventListener("pointerup", l.up);
    window.removeEventListener("pointercancel", l.cancel);
    listenersRef.current = null;
  };

  const clearDragTimers = () => {
    window.clearTimeout(entryTimerRef.current);
    entryTimerRef.current = undefined;
    window.clearTimeout(settleTimerRef.current);
    settleTimerRef.current = undefined;
    pendingSlotRef.current = null;
  };

  const positionOverlay = (x: number, y: number) => {
    const el = overlayRef.current;
    const d = dragRef.current;
    if (!el || !d) return;
    // 以原始卡片位置为锚点，只对移动增量取整到像素网格：
    // 整条位置取整会让不同分数列（243 / 520.75 / 798.5…）的对齐结果不一，
    // 出现偶数列偏移、奇数列不偏移；锚点取原值保证抓取时完全覆盖原卡片。
    el.style.left = `${d.originLeft + snapPx(x - d.startX)}px`;
    el.style.top = `${d.originTop + snapPx(y - d.startY)}px`;
  };

  const slotIndexAt = (x: number, y: number, slots: Slot[]): number => {
    // 指针横向落在某列内：优先选垂直最近的槽位（行间距按最近行处理）
    let best = -1;
    let bestDy = Infinity;
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      if (x < s.rect.left || x > s.rect.right) continue;
      const dy = y < s.rect.top ? s.rect.top - y : y > s.rect.bottom ? y - s.rect.bottom : 0;
      if (dy < bestDy) {
        bestDy = dy;
        best = i;
      }
    }
    if (best >= 0) return best;
    // 列间缝隙或卡片区外：取综合最近槽位，阈值内吸附
    let bestIdx = -1;
    let bestDist = Infinity;
    slots.forEach((s, i) => {
      const dx = x < s.rect.left ? s.rect.left - x : x > s.rect.right ? x - s.rect.right : 0;
      const dy = y < s.rect.top ? s.rect.top - y : y > s.rect.bottom ? y - s.rect.bottom : 0;
      const dist = dx * dx + dy * dy;
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = i;
      }
    });
    return bestDist <= OUTSIDE_DIST * OUTSIDE_DIST ? bestIdx : -1;
  };

  const applyLayout = (idx: number) => {
    const d = dragRef.current;
    if (!d) return;
    if (idx >= 0 && idx !== d.base.get(d.key)) d.everLeft = true;
    d.entered = idx;
    setOverlayNum(idx >= 0 ? idx + 1 : d.slots.length);
    const order = [...d.virtual.entries()].sort((a, b) => a[1] - b[1]).map(([k]) => k);
    const others = order.filter((k) => k !== d.key);
    let target: Map<string, number>;
    let ghostSlot: number;
    if (idx < 0) {
      // 补位：不在槽位上，其他卡压回 01，被拖卡占最后槽位（松手即追加到末尾）
      target = new Map(others.map((k, i) => [k, i]));
      ghostSlot = d.slots.length - 1;
    } else {
      // 避让：被拖卡占 idx，其余卡一起让位
      others.splice(Math.min(idx, others.length), 0, d.key);
      target = new Map(others.map((k, i) => [k, i]));
      ghostSlot = idx;
    }
    const duration = idx < 0 ? LAYOUT_ANIM_OUTSIDE_MS : LAYOUT_ANIM_MS;
    const trans = `transform ${duration}ms cubic-bezier(0.22, 1, 0.36, 1)`;
    for (const [k, v] of d.virtual) {
      if (k === d.key) continue;
      const t = target.get(k);
      if (t == null || t === v) continue;
      const baseIdx = d.base.get(k);
      if (baseIdx == null) continue;
      const baseRect = d.slots[baseIdx].rect;
      const toRect = d.slots[t].rect;
      const el = document.querySelector<HTMLElement>(`[data-dnd-id="${k}"]`);
      if (el) {
        el.style.transition = trans;
        el.style.transform = `translate(${snapPx(toRect.left - baseRect.left)}px, ${snapPx(toRect.top - baseRect.top)}px)`;
      }
    }
    // 被拖卡自身就地占位：在网格流内移动它，避免出现第二张卡抢占槽位
    const draggedEl = document.querySelector<HTMLElement>(`[data-dnd-id="${d.key}"]`);
    const draggedBase = d.base.get(d.key);
    if (draggedEl && draggedBase != null) {
      const baseRect = d.slots[draggedBase].rect;
      const toRect = d.slots[ghostSlot].rect;
      draggedEl.style.transition = trans;
      draggedEl.style.transform = `translate(${snapPx(toRect.left - baseRect.left)}px, ${snapPx(toRect.top - baseRect.top)}px)`;
    }
    d.virtual = target;
    animEndRef.current = performance.now() + LAYOUT_ANIM_MS + ANIM_SETTLE_BUFFER_MS;
    setTick((t) => t + 1);
  };

  const commitDragOrder = (d: DragSession, target: number) => {
    const { markDirty, commitOrder } = optionsRef.current;
    markDirty();
    commitOrder(d.key, target);
  };

  const finalizeDrop = (
    d: DragSession,
    from: DOMRect | undefined,
    content: ReactNode,
  ) => {
    settlingRef.current = false;
    // 与预览一致：在槽位上按槽位落点，槽位外追加到末尾
    const finalSlot = d.entered >= 0 ? d.entered : d.slots.length - 1;
    // 落点固定取目标槽位坐标，避免动画中松手时飞行动画落到错误位置
    const to = d.slots[finalSlot].rect;
    resetCardStyles();
    // 清掉位移与 DOM 重排必须同帧提交：中间若被浏览器插一帧，
    // 避让中的卡片会先弹回原位再跳到新位，表现为“闪一下/抽搐”。
    flushSync(() => {
      commitDragOrder(d, finalSlot);
      setTick((t) => t + 1);
      if (from) {
        // 端点保持精确：占位框在分数坐标（520.75px）上，起点/终点取整会在
        // 落地瞬间露出占位框虚线；中间帧由 FlyPath 取整保证文字不发虚。
        const box = (r: DOMRect) => ({ left: r.left, top: r.top, width: r.width, height: r.height });
        // 显式锁定原卡片内容隐藏，避免任何渲染时序让它在飞行动画中闪现
        const draggedEl = document.querySelector<HTMLElement>(`[data-dnd-id="${d.key}"]`);
        if (draggedEl) draggedEl.setAttribute("data-fly-hidden", "1");
        setActiveKey(null);
        setDragSize(null);
        dragRef.current = null;
        window.clearTimeout(flySafetyRef.current);
        // 落地动画完成时机不依赖 framer 的回调（其 WAAPI 阴影动画不会被等待），
        // 用固定计时器保证：动画 + 无阴影停顿结束后，再揭示原卡片。
        flySafetyRef.current = window.setTimeout(() => {
          setFly((prev) => {
            if (prev) {
              revealDraggedCards();
              flyRef.current = null;
            }
            return null;
          });
        }, FLY_TOTAL_MS);
        const nextFly = {
          id: ++flyIdRef.current,
          key: d.key,
          content,
          from: box(from),
          // 飞行副本保持原卡尺寸，只把落点坐标移过去，避免高低不同的卡互相拉伸
          to: { left: to.left, top: to.top, width: from.width, height: from.height },
        };
        setFly(nextFly);
        flyRef.current = nextFly;
        return;
      }
      setActiveKey(null);
      setDragSize(null);
      dragRef.current = null;
    });
  };

  const renderOverlay = useCallback((key: string, num: number): ReactNode => {
    const content = overlayContentRef.current(key, num);
    if (content == null) {
      const html = dragRef.current?.html;
      if (html) return <div dangerouslySetInnerHTML={{ __html: html }} />;
      return null;
    }
    return (
      <>
        <div className="drag-bar">
          <span className="drag-bar-line" />
        </div>
        {content}
      </>
    );
  }, []);

  const startDrag = useCallback((key: string, x: number, y: number) => {
    const token = ++dragTokenRef.current;
    settlingRef.current = false;
    removeListeners();
    clearDragTimers();
    window.clearTimeout(flySafetyRef.current);
    setFly(null);
    flyRef.current = null;
    resetCardStyles();
    pointerDownRef.current = true;

    const els = Array.from(document.querySelectorAll<HTMLElement>(`[data-dnd-group="${group}"]`));
    const slots = els.map((el) => ({ key: el.dataset.dndId!, rect: el.getBoundingClientRect() }));
    const order = slots.map((s) => s.key);
    const base = new Map(order.map((k, i) => [k, i]));
    const origin = slots.find((s) => s.key === key);
    if (!origin) {
      dragRef.current = null;
      setActiveKey(null);
      setDragSize(null);
      return;
    }
    const originEl = document.querySelector<HTMLElement>(`[data-dnd-id="${key}"]`);
    dragRef.current = {
      key,
      slots,
      base,
      virtual: new Map(base),
      entered: base.get(key)!,
      everLeft: false,
      offsetX: x - origin.rect.left,
      offsetY: y - origin.rect.top,
      startX: x,
      startY: y,
      originLeft: origin.rect.left,
      originTop: origin.rect.top,
      armed: false,
      html: originEl?.innerHTML,
    };

    // 按下不立即进入拖拽：移动越过阈值才应用占位/阴影/飞行副本，
    // 原地点击（含狂点）不会让卡片闪动。
    const arm = (d: DragSession, px: number, py: number) => {
      d.armed = true;
      setActiveKey(d.key);
      setOverlayNum(d.base.get(d.key)! + 1);
      // 宽度/高度用实测原值：分数列宽（如 265.75px）取整会让飞行副本比原卡片
      // 宽/窄最多 0.5px；位置仍由 positionOverlay 取整，保证文字不发虚。
      const originRect = d.slots[d.entered].rect;
      setDragSize({ width: originRect.width, height: originRect.height });
      const tryPosition = () => {
        if (overlayRef.current) {
          positionOverlay(px, py);
        } else {
          requestAnimationFrame(tryPosition);
        }
      };
      tryPosition();
    };

    const onMove = (e: PointerEvent) => {
      if (dragTokenRef.current !== token) return;
      const d = dragRef.current;
      if (!d) return;
      if (!d.armed) {
        if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 4) return;
        arm(d, e.clientX, e.clientY);
      }
      positionOverlay(e.clientX, e.clientY);
      const idx = slotIndexAt(e.clientX, e.clientY, d.slots);
      if (idx < 0 && !d.everLeft) {
        // 还没离开过原位：忽略“槽位外=末尾”，并取消未生效的调度
        if (pendingSlotRef.current !== null) {
          window.clearTimeout(entryTimerRef.current);
          pendingSlotRef.current = null;
        }
        return;
      }
      if (idx === d.entered) {
        // 回到当前生效槽位：取消还没生效的调度，避免绕圈后旧调度把占位带偏
        if (pendingSlotRef.current !== null && pendingSlotRef.current !== idx) {
          window.clearTimeout(entryTimerRef.current);
          pendingSlotRef.current = null;
        }
        return;
      }
      if (pendingSlotRef.current === idx) return; // 消抖计时中
      window.clearTimeout(entryTimerRef.current);
      pendingSlotRef.current = idx;
      const timerToken = token;
      entryTimerRef.current = window.setTimeout(() => {
        if (dragTokenRef.current !== timerToken) return;
        pendingSlotRef.current = null;
        applyLayout(idx);
      }, ENTER_DEBOUNCE_MS);
    };

    const onUp = (e: PointerEvent) => {
      if (dragTokenRef.current !== token) return;
      const d = dragRef.current;
      pointerDownRef.current = false;
      removeListeners();
      clearDragTimers();
      if (!d) return;
      // 未越过阈值的点击：没有任何视觉变化，直接清理
      if (!d.armed) {
        resetCardStyles();
        dragRef.current = null;
        setActiveKey(null);
        setDragSize(null);
        setFly(null);
        flyRef.current = null;
        setTick((t) => t + 1);
        return;
      }
      // 原地点击（几乎没移动）：按点击处理直接还原，不触发占位/飞行动画，
      // 避免卡片被“拎起”又落回造成闪烁
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 4) {
        resetCardStyles();
        dragRef.current = null;
        setActiveKey(null);
        setDragSize(null);
        setFly(null);
        flyRef.current = null;
        setTick((t) => t + 1);
        return;
      }
      // 松手瞬间按当前指针位置结算，防止快速拖拽时防抖未触发导致落点滞后
      const idx = slotIndexAt(e.clientX, e.clientY, d.slots);
      if (idx !== d.entered && !(idx < 0 && !d.everLeft)) applyLayout(idx);
      // 松手到落地之间冻结徽标数字：让卡片先移动到目标位，数字再随到位一起更新
      settlingRef.current = true;
      const from = overlayRef.current?.getBoundingClientRect();
      const num = d.entered >= 0 ? d.entered + 1 : d.slots.length;
      const content = renderOverlay(d.key, num);
      // 若布局动画仍在进行，等它走完再落地，占位先停到最终槽位
      const remaining = Math.max(0, animEndRef.current - performance.now());
      if (remaining > 0) {
        const settleToken = token;
        settleTimerRef.current = window.setTimeout(() => {
          settleTimerRef.current = undefined;
          if (dragTokenRef.current !== settleToken || dragRef.current !== d) return;
          finalizeDrop(d, from, content);
        }, remaining);
      } else {
        finalizeDrop(d, from, content);
      }
    };

    const onCancel = () => {
      if (dragTokenRef.current !== token) return;
      pointerDownRef.current = false;
      settlingRef.current = false;
      removeListeners();
      clearDragTimers();
      resetCardStyles();
      dragRef.current = null;
      setActiveKey(null);
      setDragSize(null);
      setFly(null);
      flyRef.current = null;
      setTick((t) => t + 1);
    };

    listenersRef.current = { move: onMove, up: onUp, cancel: onCancel };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
  }, [group]);

  const cancelDrag = useCallback(() => {
    pointerDownRef.current = false;
    settlingRef.current = false;
    window.clearTimeout(flySafetyRef.current);
    removeListeners();
    clearDragTimers();
    resetCardStyles();
    dragRef.current = null;
    setActiveKey(null);
    setDragSize(null);
    setFly(null);
    flyRef.current = null;
    setTick((t) => t + 1);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancelDrag();
    };
    const onBlurSafe = () => {
      // 指针仍按住时（真实拖拽中）失焦不取消，避免首次交互的焦点抖动误伤
      // 落地动画进行中也不取消，避免飞行副本突然消失、原卡片瞬间弹出造成闪烁
      if (pointerDownRef.current || flyRef.current) return;
      cancelDrag();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onBlurSafe);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onBlurSafe);
    };
  }, []);

  const virtualIndexOf = useCallback(
    (key: string): number | null =>
      dragRef.current && !settlingRef.current
        ? dragRef.current.virtual.get(key) ?? null
        : null,
    [],
  );

  const completeFly = useCallback((id: number) => {
    window.clearTimeout(flySafetyRef.current);
    setFly((prev) => {
      if (prev && prev.id === id) {
        revealDraggedCards();
        flyRef.current = null;
        return null;
      }
      return prev;
    });
  }, []);

  return {
    activeKey,
    dragSize,
    overlayNum,
    fly,
    overlayRef,
    startDrag,
    cancelDrag,
    completeFly,
    virtualIndexOf,
    renderOverlay,
  };
}
