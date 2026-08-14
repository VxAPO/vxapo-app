import { useEffect, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { arrayMove } from "@dnd-kit/sortable";
import type { Block } from "../lib/model";
import { buildSemanticUnits } from "../lib/blocks";

/** 稳定性约束：消抖必须长于所有拖拽动画，避免动画未结束又触发新一轮布局 */
const ENTER_DEBOUNCE_MS = 500;
const LAYOUT_ANIM_MS = 400;
const LAYOUT_ANIM_OUTSIDE_MS = 320;

export interface FlyState {
  id: number;
  key: string;
  content: ReactNode;
  from: { left: number; top: number; width: number; height: number };
  to: { left: number; top: number; width: number; height: number };
}

interface Slot {
  key: string;
  rect: DOMRect;
}

interface DragSession {
  key: string;
  slots: Slot[];
  base: Map<string, number>;
  virtual: Map<string, number>;
  entered: number;
  /** 是否曾进入过其他槽位：没离开过原位时，“槽位外=末尾”不应生效 */
  everLeft: boolean;
  /** 抓取点相对卡片左上角的偏移，悬浮层跟随指针但不跳动 */
  offsetX: number;
  offsetY: number;
  html?: string;
}

interface DragListeners {
  move: (e: PointerEvent) => void;
  up: (e: PointerEvent) => void;
  cancel: (e: PointerEvent) => void;
}

interface UseDragSortOptions {
  setBlocks: Dispatch<SetStateAction<Block[]>>;
  markDirty: () => void;
  overlayContent: (key: string, num: number) => ReactNode;
}

export function useDragSort({ setBlocks, markDirty, overlayContent }: UseDragSortOptions) {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [dragSize, setDragSize] = useState<{ width: number; height: number } | null>(null);
  const [overlayNum, setOverlayNum] = useState(0);
  const [, setTick] = useState(0);
  const [fly, setFly] = useState<FlyState | null>(null);

  const overlayRef = useRef<HTMLDivElement | null>(null);
  const flyIdRef = useRef(0);
  const dragRef = useRef<DragSession | null>(null);
  const entryTimerRef = useRef<number | undefined>(undefined);
  const pendingSlotRef = useRef<number | null>(null);
  const dragTokenRef = useRef(0);
  const listenersRef = useRef<DragListeners | null>(null);
  const pointerDownRef = useRef(false);
  const overlayContentRef = useRef(overlayContent);
  overlayContentRef.current = overlayContent;

  const resetCardStyles = () => {
    document.querySelectorAll<HTMLElement>("[data-dnd-id]").forEach((el) => {
      el.style.transition = "none";
      el.style.transform = "none";
    });
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
    pendingSlotRef.current = null;
  };

  const positionOverlay = (x: number, y: number) => {
    const el = overlayRef.current;
    const d = dragRef.current;
    if (!el || !d) return;
    el.style.left = `${x - d.offsetX}px`;
    el.style.top = `${y - d.offsetY}px`;
  };

  const slotIndexAt = (x: number, y: number, slots: Slot[]): number =>
    slots.findIndex(
      (s) =>
        s.rect.left <= x &&
        x <= s.rect.right &&
        s.rect.top <= y &&
        y <= s.rect.bottom,
    );

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
        el.style.transform = `translate(${toRect.left - baseRect.left}px, ${toRect.top - baseRect.top}px)`;
      }
    }
    // 被拖卡本身就地占位：在网格流内移动它，避免出现第二张卡挤占槽位
    const draggedEl = document.querySelector<HTMLElement>(`[data-dnd-id="${d.key}"]`);
    const draggedBase = d.base.get(d.key);
    if (draggedEl && draggedBase != null) {
      const baseRect = d.slots[draggedBase].rect;
      const toRect = d.slots[ghostSlot].rect;
      draggedEl.style.transition = trans;
      draggedEl.style.transform = `translate(${toRect.left - baseRect.left}px, ${toRect.top - baseRect.top}px)`;
    }
    d.virtual = target;
    setTick((t) => t + 1);
  };

  const commitDragOrder = (d: DragSession, target: number) => {
    markDirty();
    const key = d.key;
    if (key.startsWith("s-") || key.startsWith("g-")) {
      setBlocks((prev) => {
        const units = buildSemanticUnits(prev);
        const oi = units.findIndex((u) => u.key === key);
        if (oi < 0 || oi === target) return prev;
        return arrayMove(units, oi, target).flatMap((u) => u.blocks);
      });
    } else {
      setBlocks((prev) => {
        const oi = prev.findIndex((b) => b.id === key);
        if (oi < 0 || oi === target) return prev;
        return arrayMove(prev, oi, target);
      });
    }
  };

  const finalizeDrop = (
    d: DragSession,
    from: DOMRect | undefined,
    content: ReactNode,
  ) => {
    // 与预览一致：在槽位上按槽位落点，槽位外追加到末尾
    const finalSlot = d.entered >= 0 ? d.entered : d.slots.length - 1;
    commitDragOrder(d, finalSlot);
    const draggedEl = document.querySelector<HTMLElement>(`[data-dnd-id="${d.key}"]`);
    const to = draggedEl?.getBoundingClientRect() ?? d.slots[finalSlot].rect;
    resetCardStyles();
    setTick((t) => t + 1);
    if (from) {
      const box = (r: DOMRect) => ({ left: r.left, top: r.top, width: r.width, height: r.height });
      setActiveKey(null);
      setDragSize(null);
      dragRef.current = null;
      setFly({
        id: ++flyIdRef.current,
        key: d.key,
        content,
        from: box(from),
        to: box(to),
      });
      return;
    }
    setActiveKey(null);
    setDragSize(null);
    dragRef.current = null;
  };

  const renderOverlay = (key: string, num: number): ReactNode => {
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
  };

  const startDrag = (key: string, x: number, y: number) => {
    const token = ++dragTokenRef.current;
    removeListeners();
    clearDragTimers();
    setFly(null);
    resetCardStyles();
    pointerDownRef.current = true;

    const els = Array.from(document.querySelectorAll<HTMLElement>("[data-dnd-id]"));
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
      html: originEl?.innerHTML,
    };
    setActiveKey(key);
    setOverlayNum(base.get(key)! + 1);
    setDragSize({ width: origin.rect.width, height: origin.rect.height });
    const tryPosition = () => {
      if (overlayRef.current) {
        positionOverlay(x, y);
      } else {
        requestAnimationFrame(tryPosition);
      }
    };
    tryPosition();

    const onMove = (e: PointerEvent) => {
      if (dragTokenRef.current !== token) return;
      const d = dragRef.current;
      if (!d) return;
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
      // 松手瞬间按当前指针位置结算，防止快速拖拽时防抖未触发导致落点滞后
      const idx = slotIndexAt(e.clientX, e.clientY, d.slots);
      if (idx !== d.entered && !(idx < 0 && !d.everLeft)) applyLayout(idx);
      const from = overlayRef.current?.getBoundingClientRect();
      const num = d.entered >= 0 ? d.entered + 1 : d.slots.length;
      const content = renderOverlay(d.key, num);
      finalizeDrop(d, from, content);
    };

    const onCancel = () => {
      if (dragTokenRef.current !== token) return;
      pointerDownRef.current = false;
      removeListeners();
      clearDragTimers();
      resetCardStyles();
      dragRef.current = null;
      setActiveKey(null);
      setDragSize(null);
      setFly(null);
      setTick((t) => t + 1);
    };

    listenersRef.current = { move: onMove, up: onUp, cancel: onCancel };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
  };

  const cancelDrag = () => {
    pointerDownRef.current = false;
    removeListeners();
    clearDragTimers();
    resetCardStyles();
    dragRef.current = null;
    setActiveKey(null);
    setDragSize(null);
    setFly(null);
    setTick((t) => t + 1);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancelDrag();
    };
    const onBlurSafe = () => {
      // 指针仍按住时（真实拖拽中）失焦不取消，避免首次交互的焦点抖动误伤
      if (pointerDownRef.current) return;
      cancelDrag();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("blur", onBlurSafe);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onBlurSafe);
    };
  }, []);

  const virtualIndexOf = (key: string): number | null =>
    dragRef.current ? dragRef.current.virtual.get(key) ?? null : null;

  const completeFly = (id: number) =>
    setFly((prev) => (prev && prev.id === id ? null : prev));

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
