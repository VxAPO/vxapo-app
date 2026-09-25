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
  LAYOUT_EASE,
  OUTSIDE_DIST,
  Slot,
  UseDragSortOptions,
} from "../lib/dragSortTypes";

/**
 * 卡片查询范围：两套视图常驻 DOM 后必须排除非当前视图，
 * 否则拖拽会同时命中隐藏视图里的同名卡片。
 */
function cardScope(): ParentNode {
  return (
    document.querySelector<HTMLElement>(".view-stage.is-active") ?? document
  );
}

/** 活动视图舞台元素：滚动增量的测量基准（拖拽只发生在当前视图内）。 */
function scopeEl(): HTMLElement {
  return document.querySelector<HTMLElement>(".view-stage.is-active") ?? document.documentElement;
}

export function useDragSort({ group, markDirty, overlayContent, commitOrder }: UseDragSortOptions) {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [dragSize, setDragSize] = useState<{ width: number; height: number } | null>(null);
  const [overlayNum, setOverlayNum] = useState(0);
  const [dragTick, setTick] = useState(0);
  const [fly, setFly] = useState<FlyState | null>(null);

  const overlayRef = useRef<HTMLDivElement | null>(null);
  const flyRef = useRef<FlyState | null>(null);
  const flyIdRef = useRef(0);
  /** 飞行副本元素（DragLayer 侧挂同一个 ref）：滚动补偿要按它做命令式平移 */
  const flyElRef = useRef<HTMLDivElement | null>(null);
  /** 飞行副本创建那一刻，活动视图舞台的视口坐标（滚动增量基准） */
  const flyScopeRef = useRef<{ left: number; top: number } | null>(null);
  /** 飞行副本的落点（吸附后）：滚动补偿以它为基准平移 */
  const flyLandRef = useRef({ left: 0, top: 0 });
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
  /**
   * 跟手帧的合帧调度：一帧内的多次 pointermove / scroll 只结算一次。
   * 高频指针（高刷触控板、游戏鼠标）一秒能发几百个 move，逐个处理等于同一帧里
   * 反复写样式、反复测矩形；合帧后每帧只写一次最新位置、只测一次矩形。
   */
  const frameRef = useRef<number | undefined>(undefined);
  const pendingPosRef = useRef<{ x: number; y: number } | null>(null);
  const scrollDirtyRef = useRef(false);

  const revealDraggedCards = () => {
    // 兜底：无论 is-dragging 类是否被状态更新打断，落地动画期间原卡片内容都必须保持隐藏
    document
      .querySelectorAll<HTMLElement>("[data-fly-hidden]")
      .forEach((el) => el.removeAttribute("data-fly-hidden"));
  };

  const resetCardStyles = () => {
    cardScope().querySelectorAll<HTMLElement>("[data-dnd-id]").forEach((el) => {
      // 清掉拖拽期间的内联过渡，恢复 CSS 的 hover 阴影淡入
      el.style.transition = "";
      el.style.transform = "none";
    });
    revealDraggedCards();
  };

  /** 丢弃未决的合帧回调（拖拽结束/取消时调用，防止回调落到下一次拖拽上） */
  const stopFrame = () => {
    if (frameRef.current !== undefined) {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = undefined;
    }
    pendingPosRef.current = null;
    scrollDirtyRef.current = false;
  };

  const removeListeners = () => {
    stopFrame();
    const l = listenersRef.current;
    if (!l) return;
    window.removeEventListener("pointermove", l.move);
    window.removeEventListener("pointerup", l.up);
    window.removeEventListener("pointercancel", l.cancel);
    window.removeEventListener("scroll", l.scroll, true);
    listenersRef.current = null;
  };

  /**
   * 拖拽期间页面滚动：槽位矩形随内容整体平移同样的量，按滚动增量平移即可。
   * 不能重新测量卡片——布局动画会给卡片挂内联 transform，量到的是动画中间态。
   */
  const shiftSlots = (d: DragSession, dx: number, dy: number) => {
    if (!dx && !dy) return;
    d.slots.forEach((s) => {
      s.rect = new DOMRect(s.rect.left + dx, s.rect.top + dy, s.rect.width, s.rect.height);
    });
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
    //
    // 位移走 `transform: translate()`（`left`/`top` 留在 CSS 的 0 作静态基准）：
    // 逐帧写 left/top 属于布局属性，每帧都要重新布局；transform 只改视觉位置。
    // 刻意不用 translate3d / will-change —— 那是把悬浮层升成合成层，拖动停住时
    // 文字栅格会与常规层不同（见 DragLayer 的「落地交接」注释），跟手过程中得不偿失。
    const left = d.originLeft + snapPx(x - d.startX);
    const top = d.originTop + snapPx(y - d.startY);
    el.style.transform = `translate(${left}px, ${top}px)`;
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

  /** 应用槽位布局（只改内联 transform/transition，卡片因此平滑让位）。 */
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
    const trans = `transform ${duration}ms ${LAYOUT_EASE}`;
    // 一次收齐本组元素再逐卡写样式：原先每个 key 各做一次 querySelector，槽位多时是 O(卡数²)
    const els = new Map<string, HTMLElement>();
    cardScope()
      .querySelectorAll<HTMLElement>(`[data-dnd-group="${group}"]`)
      .forEach((el) => {
        const id = el.dataset.dndId;
        if (id) els.set(id, el);
      });
    for (const [k, v] of d.virtual) {
      if (k === d.key) continue;
      const t = target.get(k);
      if (t == null || t === v) continue;
      const baseIdx = d.base.get(k);
      if (baseIdx == null) continue;
      const baseRect = d.slots[baseIdx].rect;
      const toRect = d.slots[t].rect;
      const el = els.get(k);
      if (el) {
        el.style.transition = trans;
        el.style.transform = `translate(${snapPx(toRect.left - baseRect.left)}px, ${snapPx(toRect.top - baseRect.top)}px)`;
      }
    }
    // 被拖卡自身就地占位：在网格流内移动它，避免出现第二张卡抢占槽位
    const draggedEl = els.get(d.key);
    const draggedBase = d.base.get(d.key);
    if (draggedEl && draggedBase != null) {
      const baseRect = d.slots[draggedBase].rect;
      const toRect = d.slots[ghostSlot].rect;
      draggedEl.style.transition = trans;
      draggedEl.style.transform = `translate(${snapPx(toRect.left - baseRect.left)}px, ${snapPx(toRect.top - baseRect.top)}px)`;
    }
    d.virtual = target;
    // 记账要用**本次实际用的**时长：槽位外补位跑的是 OUTSIDE 时长，按 LAYOUT_ANIM_MS 记会让
    // 动画早已停住、落地却还没开始（松手后白等一截）。
    animEndRef.current = performance.now() + duration + ANIM_SETTLE_BUFFER_MS;
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
    resetCardStyles();
    // ① 清位移 + DOM 重排必须同帧提交：中间若被浏览器插一帧，
    //    避让中的卡片会先弹回原位再跳到新位，表现为“闪一下/抽搐”。
    flushSync(() => {
      commitDragOrder(d, finalSlot);
      setTick((t) => t + 1);
    });
    // ② 此刻 DOM 已按新顺序排好、同一任务内尚未绘制：量到的是静止后的**真实**落点。
    //    拖动期间页面可能滚过、重排后列内堆叠也可能微移，用拖动开始时的槽位矩形会差几像素。
    let target: { left: number; top: number; width: number; height: number } =
      d.slots[finalSlot].rect;
    if (from) {
      const landed = cardScope().querySelector<HTMLElement>(`[data-dnd-id="${d.key}"]`);
      if (landed) target = landed.getBoundingClientRect();
    }
    // ③ 再同步提交“隐藏原卡 + 起飞行副本”：同样不跨帧，避免中间出现既无悬浮层也无副本的空档。
    flushSync(() => {
      if (from) {
        const box = (r: { left: number; top: number; width: number; height: number }) => ({
          left: r.left,
          top: r.top,
          width: r.width,
          height: r.height,
        });
        // 显式锁定原卡片内容隐藏，避免任何渲染时序让它在飞行动画中闪现
        const draggedEl = cardScope().querySelector<HTMLElement>(`[data-dnd-id="${d.key}"]`);
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
          to: { left: target.left, top: target.top, width: from.width, height: from.height },
        };
        // 滚动补偿基准：副本属于内容，创建后用户一滚就要按内容位移把它带走
        flyScopeRef.current = scopeEl().getBoundingClientRect();
        flyLandRef.current = { left: snapPx(target.left), top: snapPx(target.top) };
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

    const els = Array.from(cardScope().querySelectorAll<HTMLElement>(`[data-dnd-group="${group}"]`));
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
    const originEl = cardScope().querySelector<HTMLElement>(`[data-dnd-id="${key}"]`);
    const scope = scopeEl().getBoundingClientRect();
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
      lastX: x,
      lastY: y,
      scopeLeft: scope.left,
      scopeTop: scope.top,
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
        // 拖拽已结束（或已被新拖拽接管）就停止轮询，避免空转的 rAF 链
        if (!dragRef.current || dragRef.current.key !== d.key) return;
        if (overlayRef.current) {
          positionOverlay(px, py);
        } else {
          requestAnimationFrame(tryPosition);
        }
      };
      tryPosition();
    };

    /** 槽位命中与进入消抖（消抖期间只记调度，计时走完才应用布局）。 */
    const hitTest = (px: number, py: number) => {
      const d = dragRef.current;
      if (!d) return;
      const idx = slotIndexAt(px, py, d.slots);
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

    /** 按指针位置更新悬浮层与占位命中（消抖后应用布局）。 */
    const updateAt = (px: number, py: number) => {
      const d = dragRef.current;
      if (!d) return;
      d.lastX = px;
      d.lastY = py;
      positionOverlay(px, py);
      hitTest(px, py);
    };

    /** 拖拽期间页面滚动：槽位矩形按滚动增量平移（不重新测量——布局动画挂在卡片上）。 */
    const syncScroll = (d: DragSession) => {
      const scope = scopeEl().getBoundingClientRect();
      const dx = scope.left - d.scopeLeft;
      const dy = scope.top - d.scopeTop;
      if (!dx && !dy) return;
      d.scopeLeft = scope.left;
      d.scopeTop = scope.top;
      shiftSlots(d, dx, dy);
    };

    /**
     * 合帧结算：一帧内攒下的指针位置与滚动只处理一次。
     * 顺序固定「先平移槽位、再定位与命中」——命中要按平移后的槽位算。
     */
    const flushFrame = () => {
      frameRef.current = undefined;
      const d = dragRef.current;
      if (!d) return;
      const scrolled = scrollDirtyRef.current;
      scrollDirtyRef.current = false;
      if (scrolled) syncScroll(d);
      const pos = pendingPosRef.current;
      pendingPosRef.current = null;
      if (pos) {
        updateAt(pos.x, pos.y);
      } else if (scrolled && d.armed) {
        // 纯滚动（没有新指针位置）：用最后位置重算命中，占位判定要跟着槽位走
        hitTest(d.lastX, d.lastY);
      }
    };

    const scheduleFrame = () => {
      // 已有未决回调就不再排——它读的是"最后写入"的位置，天然合帧
      if (frameRef.current === undefined) frameRef.current = requestAnimationFrame(flushFrame);
    };

    /** 同步结算未决帧：松手前调用，量到的起点才是指针最后停下的位置 */
    const flushFrameNow = () => {
      if (frameRef.current !== undefined) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = undefined;
      }
      flushFrame();
    };

    const onMove = (e: PointerEvent) => {
      if (dragTokenRef.current !== token) return;
      const d = dragRef.current;
      if (!d) return;
      if (!d.armed) {
        if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 4) return;
        arm(d, e.clientX, e.clientY);
      }
      // 只记录最新位置，真正的定位与命中交给下一帧统一做
      d.lastX = e.clientX;
      d.lastY = e.clientY;
      pendingPosRef.current = { x: e.clientX, y: e.clientY };
      scheduleFrame();
    };

    /**
     * 拖拽期间页面滚动（滚轮/触控板/自动滚动的都算）：拖着的卡在视口里跟手不动，
     * 但卡片区整体在动——槽位矩形必须同步平移，否则占位框与落点判定会按旧坐标算。
     * 滚动事件比帧还密，量舞台矩形（强制布局）与写样式都合到帧里做。
     */
    const onScroll = () => {
      if (!dragRef.current) return;
      scrollDirtyRef.current = true;
      scheduleFrame();
    };

    const onUp = (e: PointerEvent) => {
      if (dragTokenRef.current !== token) return;
      const d = dragRef.current;
      pointerDownRef.current = false;
      // 先把未决的跟手帧结算掉：松手那一帧的位置可能还没写进样式，
      // 从悬浮层量到的飞行起点必须是视觉上的当前位置
      flushFrameNow();
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
      // 落点结算沿用**已生效的槽位**（`d.entered`），不再按松手瞬间的指针位置重算：
      // 一按指针重算就等于给松手开了"零防抖"通道——占位框会在松手那一下突然跳到
      // 尚未确认的槽位，紧接着还要等这记布局动画跑完才起飞行，串联起来就是松手卡一下。
      // 现在占位框停在哪、卡片就落在哪（所见即所得），松手不再产生任何布局变更。
      // 松手到落地之间冻结徽标数字：让卡片先移动到目标位，数字再随到位一起更新
      settlingRef.current = true;
      const from = overlayRef.current?.getBoundingClientRect();
      const num = d.entered >= 0 ? d.entered + 1 : d.slots.length;
      const content = renderOverlay(d.key, num);
      // 若布局动画仍在进行，等它走完再落地，占位先停到最终槽位。
      // 布局动画已结束时也不在 pointerup 里同步做：finalizeDrop 要提交重排 + 量落点 +
      // 两次 flushSync 渲染，塞在输入回调里会拖住输入管线（手感上就是"松手卡一下"）。
      // 用 0ms 定时器推到当前任务之后、绘制之前，位置与视觉结果不变。
      const remaining = Math.max(0, animEndRef.current - performance.now());
      const settleToken = token;
      settleTimerRef.current = window.setTimeout(
        () => {
          settleTimerRef.current = undefined;
          if (dragTokenRef.current !== settleToken || dragRef.current !== d) return;
          finalizeDrop(d, from, content);
        },
        remaining > 0 ? remaining : 0,
      );
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

    listenersRef.current = { move: onMove, up: onUp, cancel: onCancel, scroll: onScroll };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    // 滚动事件不冒泡，用捕获阶段在 window 上统一收（页面/侧栏任何滚动容器都覆盖）
    window.addEventListener("scroll", onScroll, true);
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

  /**
   * 飞行期间页面滚动：副本属于**内容**，不能停在视口坐标上。
   * 落点是创建那一刻的视口坐标，用户一滚，整条弧线就被内容甩掉（看着就是"动画被滚动带偏"）。
   * 这里按活动视图舞台的位移反向平移副本基准，弧线跟着内容走，终点始终压在目标槽位上。
   * 元素层级是 fixed（在滚动容器之外），所以只能用命令式补偿——顺便避免每滚一帧重渲染。
   */
  useEffect(() => {
    let raf: number | undefined;
    let dirty = false;
    const apply = () => {
      raf = undefined;
      if (!dirty) return;
      dirty = false;
      const el = flyElRef.current;
      const base = flyScopeRef.current;
      if (!el || !base) return;
      const r = scopeEl().getBoundingClientRect();
      const dx = r.left - base.left;
      const dy = r.top - base.top;
      if (!dx && !dy) return;
      el.style.left = `${flyLandRef.current.left - dx}px`;
      el.style.top = `${flyLandRef.current.top - dy}px`;
    };
    // 滚动事件比帧还密：测矩形（强制布局）与写样式合到帧里，一帧最多一次
    const onScroll = () => {
      if (!flyElRef.current || !flyScopeRef.current) return;
      dirty = true;
      if (raf === undefined) raf = requestAnimationFrame(apply);
    };
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      if (raf !== undefined) cancelAnimationFrame(raf);
    };
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
    [dragTick],
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
    flyElRef,
    startDrag,
    cancelDrag,
    completeFly,
    virtualIndexOf,
    renderOverlay,
  };
}
