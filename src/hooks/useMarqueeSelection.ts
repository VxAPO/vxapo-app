import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Block, ViewMode } from "../lib/model";
import { channelLabel } from "../lib/channels";
import { snapPx } from "../lib/snap";
import { t } from "../lib/i18n/core";

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

/**
 * 工具栏目标的"停留防抖"（ms）：拖动期目标一变就重置定时器，
 * 只有"框住的卡连续 100ms 没变"才采纳一次。用于滤掉卡片入框次序造成的中间态。
 */
const TOOLBAR_TARGET_SETTLE_MS = 50;
/**
 * 飞行时长随**距离**缩放（与视图收窄"260ms + 2ms/px、上限 800ms"同思路）：
 * 固定 480ms 的问题是——远距离在 480ms 内冲完（加速太快、刹车太猛），
 * 近距离也用掉 480ms（离近了停得太慢）。
 * 缓动仍是原来那套 easeOut、指数 2.6（先快后慢、收尾柔）。
 */
const TOOLBAR_FLIGHT_MIN_MS = 300;
const TOOLBAR_FLIGHT_BASE_MS = 300;
const TOOLBAR_FLIGHT_PER_PX = 0.5;
const TOOLBAR_FLIGHT_MAX_MS = 560;
const TOOLBAR_FLIGHT_EASE_POW = 2.6;
/** 工具栏与选中范围的间距、与容器边的留白 */
const TOOLBAR_GAP = 10;
const TOOLBAR_EDGE = 8;

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
  // 拖动前是否已有工具栏：有则再次框选时工具栏保持显示
  const hadToolbarRef = useRef(false);
  const pendingMarqueeRef = useRef<{
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  } | null>(null);
  const lastLiveCommitRef = useRef(0);
  const toolbarElRef = useRef<HTMLDivElement | null>(null);
  const [toolbarH, setToolbarH] = useState(64);
  const [toolbarW, setToolbarW] = useState(280);
  const toolbarAnimRef = useRef<{
    raf: number;
    start: { x: number; y: number };
    to: { x: number; y: number };
    t0: number;
    /** 当前位置（跨帧积分，不每帧重启，避免"按距离比例"的指数逼近） */
    pos: { x: number; y: number };
    /** 当前速度（px/s），方向反转时不归零：减速→反向加速 */
    v: { x: number; y: number };
  } | null>(null);
  /** 最新目标与当前显示位置 / 速度：事件期直接写 ref，不经过 React 提交节流 */
  const toolbarTargetRef = useRef<{ x: number; y: number } | null>(null);
  const toolbarPosRef = useRef<{ x: number; y: number } | null>(null);
  const toolbarVelRef = useRef({ x: 0, y: 0 });
  const toolbarLastTsRef = useRef(0);
  const toolbarBoundElRef = useRef<HTMLDivElement | null>(null);
  /** 拖动期的"停留防抖"目标（见 TOOLBAR_TARGET_SETTLE_MS） */
  const liveTargetRef = useRef<{ x: number; y: number } | null>(null);
  const liveTargetTimerRef = useRef(0);

  /** 按选中范围包围盒算工具栏目标位置（React 路径与拖动实时路径共用同一套规则） */
  const toolbarTargetFor = useCallback(
    (
      minX: number,
      maxX: number,
      minY: number,
      maxY: number,
      bodyW: number,
      bodyH: number,
    ) => {
      const cx = (minX + maxX) / 2;
      const x = snapPx(
        Math.max(
          TOOLBAR_EDGE + toolbarW / 2,
          Math.min(cx, bodyW - TOOLBAR_EDGE - toolbarW / 2),
        ),
      );
      const belowY = maxY + TOOLBAR_GAP;
      const aboveY = minY - toolbarH - TOOLBAR_GAP;
      const rawY = belowY + toolbarH + 8 <= bodyH ? belowY : aboveY;
      const y = snapPx(
        Math.max(
          TOOLBAR_EDGE,
          Math.min(rawY, bodyH - toolbarH - TOOLBAR_EDGE),
        ),
      );
      return { x, y };
    },
    [toolbarH, toolbarW],
  );

  /**
   * 启动一段飞行：从"当前实际位置"沿二次贝塞尔飞到最新目标，easeOutQuart、400ms。
   *
   * 拖动期目标是逐帧写入的（提帧数那部分），所以这里每次都会取消上一段、
   * 以当前位置重新起算——小位移时控制点几乎贴着起点，路径就是直线；
   * 大跳（例如抬手后目标切换）才看得见弧线。
   */
  const startToolbarFlight = useCallback(() => {
    const node0 = toolbarElRef.current;
    const target0 = toolbarTargetRef.current;
    if (!node0 || !target0) return;
    if (toolbarAnimRef.current) cancelAnimationFrame(toolbarAnimRef.current.raf);
    // 位置真源：跟随循环自己维护的 ref（transform 由循环独占，不再读 style.left/top）
    const start = toolbarPosRef.current
      ? { ...toolbarPosRef.current }
      : { x: target0.x, y: target0.y };
    /**
     * 一律**直线**插值（等价于控制点放在起终点中点）。
     *
     * 原实现只给水平位移加控制点偏移：水平移动走弧线、路径更长，垂直移动走直线，
     * 于是"平移的节奏和垂直不一致"；斜向移动还按"哪个轴位移大"二选一，
     * 又多出第三种节奏。统一成直线后，任何方向都吃同一条缓动、同样的路径长度规律。
     */
    // 时长随距离缩放（近处快收，远处也别赶）
    const flightMs = Math.min(
      TOOLBAR_FLIGHT_MAX_MS,
      Math.max(
        TOOLBAR_FLIGHT_MIN_MS,
        TOOLBAR_FLIGHT_BASE_MS +
          Math.hypot(target0.x - start.x, target0.y - start.y) * TOOLBAR_FLIGHT_PER_PX,
      ),
    );
    const t0 = performance.now();
    const step = () => {
      const node = toolbarElRef.current;
      const anim = toolbarAnimRef.current;
      if (!node || !anim) {
        toolbarAnimRef.current = null;
        toolbarLastTsRef.current = 0;
        return;
      }
      // 原有缓动（easeOut，指数 2.6，480ms）：从本段起点插值到最新目标。
      // 目标由 100ms 停留防抖离散化，段内不会再变；变了下一次 targets 更新会重新起一段。
      const raw = toolbarTargetRef.current ?? anim.to;
      const p = Math.min(1, (performance.now() - t0) / flightMs);
      const k = 1 - Math.pow(1 - p, TOOLBAR_FLIGHT_EASE_POW);
      const nx = anim.start.x + (raw.x - anim.start.x) * k;
      const ny = anim.start.y + (raw.y - anim.start.y) * k;
      anim.pos.x = nx;
      anim.pos.y = ny;
      anim.v.x = 0;
      anim.v.y = 0;
      node.style.transform = `translate3d(${snapPx(nx)}px, ${snapPx(ny)}px, 0)`;
      const posMoving = Math.hypot(raw.x - nx, raw.y - ny) > 0.35;
      if (p < 1 || posMoving) {
        anim.raf = requestAnimationFrame(step);
      } else {
        toolbarAnimRef.current = null;
        toolbarLastTsRef.current = 0;
        toolbarVelRef.current = { x: 0, y: 0 };
        anim.v.x = 0;
        anim.v.y = 0;
        node.style.transform = `translate3d(${snapPx(raw.x)}px, ${snapPx(raw.y)}px, 0)`;
      }
    };
    // 位置/速度是跨帧、跨"目标更新"持久的（存在 ref 上）：拖动期每来一次 pointermove
    // 都会走 setToolbarTargetNow，若把速度状态挂在 anim 上，每次都会被打回初值，
    // 表现为"每帧减速到 0 再重新加速"的顿挫。
    toolbarPosRef.current = { x: start.x, y: start.y };
    toolbarAnimRef.current = {
      raf: requestAnimationFrame(step),
      start,
      to: target0,
      t0,
      pos: toolbarPosRef.current,
      v: toolbarVelRef.current,
    };
  }, []);

  /**
   * 事件期/React 期通用的目标更新入口。
   *
   * 一次指针事件里卡片是**逐个**进入选区的（命中顺序取决于几何与遍历顺序），
   * 而"每次选区变化就推一次目标"会让工具栏先看到"半张矩形"的目标、再看到完整目标——
   * 于是每次触发工具栏的动画起点/路径都不一样。
   * 所以这里只记录**最新**目标，真正写进跟随循环的那一步合并到下一帧执行：
   * 每一帧工具栏只看到该帧**最终**的选区包围盒，跟"卡片入框顺序"解耦。
   */
  const pendingTargetRef = useRef<{ x: number; y: number } | null>(null);
  const targetRafRef = useRef(0);
  const setToolbarTargetNow = useCallback(
    (t: { x: number; y: number }) => {
      pendingTargetRef.current = t;
      if (targetRafRef.current) return;
      targetRafRef.current = requestAnimationFrame(() => {
        targetRafRef.current = 0;
        const next = pendingTargetRef.current;
        if (!next) return;
        // 帧内合并：同一帧里的多次推只保留最后一个（选区提交/松手收尾都走这里）
        toolbarTargetRef.current = next;
        applyToolbarTarget(next);
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /** 把（已合并到本帧的）目标交给跟随：首次落位 / 重挂载起步 / 启动跟随循环 */
  const applyToolbarTarget = useCallback(
    (t: { x: number; y: number }) => {
      const node = toolbarElRef.current;
      if (!node) return;
      if (toolbarBoundElRef.current !== node) {
        // 元素重挂载（乱晃时选中集清空又填上，工具栏经 AnimatePresence 卸载/重挂）：
        // 从**上次的位置**起步飞过去，而不是直接就位 —— 直接就位会让单帧位移冲到
        // 100px 量级（实测 6200px/s，远超速度上限），看起来就是"瞬移"。
        toolbarBoundElRef.current = node;
        const prev = toolbarPosRef.current;
        if (!prev) {
          toolbarPosRef.current = { x: snapPx(t.x), y: snapPx(t.y) };
          toolbarVelRef.current = { x: 0, y: 0 };
          node.style.transform = `translate3d(${snapPx(t.x)}px, ${snapPx(t.y)}px, 0)`;
          return;
        }
        node.style.transform = `translate3d(${snapPx(prev.x)}px, ${snapPx(prev.y)}px, 0)`;
        toolbarAnimRef.current = null;
        startToolbarFlight();
        return;
      }
      if (!toolbarPosRef.current) {
        toolbarPosRef.current = { x: snapPx(t.x), y: snapPx(t.y) };
        toolbarVelRef.current = { x: 0, y: 0 };
        node.style.transform = `translate3d(${snapPx(t.x)}px, ${snapPx(t.y)}px, 0)`;
        return;
      }
      // 目标变了 → 从当前位置重新起一段缓入缓出（目标已被 100ms 防抖离散化，
      // 段率 ≥100ms，所以不会再出现"每帧重启"那种顿挫）
      startToolbarFlight();
    },
    [startToolbarFlight],
  );

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
    hadToolbarRef.current = selectedIds.length > 0;
    setMarquee({ x1: x, y1: y, x2: x, y2: y });
  };

  /**
   * 框选命中：返回命中的卡片 id **以及它们的包围盒**（内容坐标系）。
   *
   * 包围盒必须由**卡片**算，不能用框选矩形本身：矩形跟着鼠标走，而工具栏落点
   * 要对齐的是"选中卡片的宽高范围"。早先拖动期用矩形中心做目标、React 那条通路
   * 用卡片包围盒，两套目标互相打架，工具栏就会在两者之间来回被拽。
   */
  const collectMarquee = (
    m: { x1: number; y1: number; x2: number; y2: number },
    body: HTMLElement,
  ): {
    ids: string[];
    box: { minX: number; maxX: number; minY: number; maxY: number } | null;
  } => {
    const rect = body.getBoundingClientRect();
    const x1 = Math.min(m.x1, m.x2) - body.scrollLeft;
    const x2 = Math.max(m.x1, m.x2) - body.scrollLeft;
    const y1 = Math.min(m.y1, m.y2) - body.scrollTop;
    const y2 = Math.max(m.y1, m.y2) - body.scrollTop;
    if (x2 - x1 < 4 && y2 - y1 < 4) return { ids: [], box: null }; // 点空白：空选择
    const ids: string[] = [];
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    // 只扫当前视图 stage；切视图动画期间旧 stage 可能仍挂在 DOM 里，
    // 全 body 扫描会把退场卡也框进来。
    const scope = body.querySelector<HTMLElement>(
      `[data-view="${viewRef.current}"]`,
    ) ?? body;
    scope.querySelectorAll<HTMLElement>("[data-dnd-id]").forEach((el) => {
      if (el.dataset.dndGroup === "effects") return;
      const r = el.getBoundingClientRect();
      const rx = r.left - rect.left;
      const ry = r.top - rect.top;
      if (rx < x2 && rx + r.width > x1 && ry < y2 && ry + r.height > y1) {
        const id = el.dataset.dndId;
        if (id) {
          ids.push(id);
          minX = Math.min(minX, rx + body.scrollLeft);
          maxX = Math.max(maxX, rx + r.width + body.scrollLeft);
          minY = Math.min(minY, ry + body.scrollTop);
          maxY = Math.max(maxY, ry + r.height + body.scrollTop);
        }
      }
    });
    return {
      ids,
      box: ids.length ? { minX, maxX, minY, maxY } : null,
    };
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
        if (m) {
          setMarquee(m);
          // 实时框选：拖动过程中同步高亮被框住的卡片
          const body = bodyRef.current;
          if (body) {
            const hit = collectMarquee(m, body);
            const next = hit.ids;
            // 实时高亮直接改 DOM class，避免每帧触发 React 重渲；
            // React 状态低频提交，松手再最终同步一次。
            const liveSet = new Set(next);
            const scope = body.querySelector<HTMLElement>(
              `[data-view="${viewRef.current}"]`,
            ) ?? body;
            scope.querySelectorAll<HTMLElement>("[data-dnd-id]").forEach((el) => {
              const id = el.dataset.dndId;
              el.classList.toggle("is-selected", !!id && liveSet.has(id));
            });
            const now = performance.now();
            if (now - lastLiveCommitRef.current > 90) {
              lastLiveCommitRef.current = now;
              /**
               * 拖动过程中**不允许**把选中集合提交成空：渲染条件里有
               * `selectedIds.length > 0`，一旦提交空集，工具栏会被 AnimatePresence
               * 卸载、下一帧再挂回来——观感是工具栏在拖动中忽隐忽现，
               * 而且重挂后会走"首次出现直接就位"，出现单帧几十像素的硬跳。
               * 抬手时才用最终结果收尾（那时允许清空，点空白=取消选择）。
               */
              if (next.length) setSelectedIds(next);
            }
            /**
             * 工具栏目标 = **对被框选卡片集合做 100ms 停留防抖**：
             * 目标一变就重置定时器，只有"框住的卡 100ms 没变"才采纳一次。
             * 这样拖动期不会去追"半张矩形"的中间态（那是入框次序造成的，
             * 每次都不一样），停住/稳定下来之后才飞一次 —— 动画可复现。
             */
            if (hadToolbarRef.current && toolbarElRef.current && hit.box) {
              liveTargetRef.current = toolbarTargetFor(
                hit.box.minX,
                hit.box.maxX,
                hit.box.minY,
                hit.box.maxY,
                body.clientWidth,
                body.scrollHeight,
              );
              window.clearTimeout(liveTargetTimerRef.current);
              liveTargetTimerRef.current = window.setTimeout(() => {
                if (liveTargetRef.current) setToolbarTargetNow(liveTargetRef.current);
              }, TOOLBAR_TARGET_SETTLE_MS);
            }
          }
        }
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
    lastLiveCommitRef.current = 0;
    // 收尾：清掉拖动期的停留防抖（下面会用最终命中集合直接写目标）
    window.clearTimeout(liveTargetTimerRef.current);
    liveTargetTimerRef.current = 0;
    setMarquee(null);
    if (!s || !body || !m) return;
    // 实时框选期间已同步；抬手用最终矩形收尾（点空白时 helper 返回空 = 清空选择）
    const hit = collectMarquee(m, body);
    setSelectedIds(hit.ids);
    /**
     * 抬手时**必须**用最终命中集合再写一次目标。
     *
     * 否则最后一次写入可能仍是拖动途中某一帧的旧包围盒（例如少算一张卡），
     * 而拖动期的实时目标不会再被刷新——观感就是"松手后工具栏离卡片更近/更远"，
     * 且稳定复现（往下框一行再往上框时最明显）。
     */
    /**
     * 只有"拖动前工具栏已经存在"时才在这里补写目标。
     *
     * 实测：把门槛去掉（无条件写 + 强制重测几何）会让**原本正确**的"先下后上"
     * 从 10px 变成 6px——说明这两条写入路径在同一帧里还会互相覆盖，不能简单叠加。
     * 反向路径（先上后下）的 6px 是另一处成因，尚未定论，先恢复已验证正确的行为。
     */
    if (hadToolbarRef.current && hit.box) {
      setToolbarTargetNow(
        toolbarTargetFor(
          hit.box.minX,
          hit.box.maxX,
          hit.box.minY,
          hit.box.maxY,
          body.clientWidth,
          body.scrollHeight,
        ),
      );
    }
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
      // 菜单是 portal 到 body 的（见 SelectionToolbar），不在 `.sel-copy` 子树里：
      // 漏了 `.sel-copy-menu` 这一条，点在菜单项上会先被判成"点外面"而卸载菜单，
      // 后面的 click 就没元素可派了——复制直接失效。
      if (t instanceof Element && (t.closest(".sel-copy") || t.closest(".sel-copy-menu")))
        return;
      setCopyOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [copyOpen]);

  /**
   * 工具栏尺寸实测（宽度/高度都参与"内缩 8px"的夹取）。
   *
   * 盯的是**元素本身**，所以没有 deps、每轮渲染只做一次 ref 比较——**不能**拿
   * `selectedIds.length > 0` 之类当 deps：工具栏要等 `selGeom` 算出来才挂载，而 `selGeom`
   * 是**被动** effect 的产物，比 layout effect 晚一轮；按布尔量做 deps 的话，effect 会在
   * 元素还不存在的那个 commit 跑一次、`el` 为 null 直接 return，之后再也不会重跑，尺寸就
   * 永远停在兜底值（280×64）。通道选择器会把工具栏拉宽到远超兜底值，首次框选的右边界便按
   * 280 去算，工具栏直接顶出 8px 内缩线；等取消一次时退场动画期间元素还挂着，effect 才补上
   * ResizeObserver，所以第二次就正常——这个"只有首次出界"的现象就是这么来的（踩过）。
   */
  const toolbarRoRef = useRef<ResizeObserver | null>(null);
  const toolbarRoElRef = useRef<Element | null>(null);
  useLayoutEffect(() => {
    const el = toolbarElRef.current;
    if (toolbarRoElRef.current === el) return; // 已经盯着它（含两者同为 null 的未挂载态）
    toolbarRoRef.current?.disconnect();
    toolbarRoRef.current = null;
    toolbarRoElRef.current = el;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const h = entries[0]?.contentRect.height;
      const w = entries[0]?.contentRect.width;
      if (h && h > 0) setToolbarH((prev) => (prev === h ? prev : h));
      if (w && w > 0) setToolbarW((prev) => (prev === w ? prev : w));
    });
    ro.observe(el);
    toolbarRoRef.current = ro;
    // 元素刚出现：ResizeObserver 的首帧回调要等下一次布局，这里**同步**量一次，
    // 让首次落位就用真实尺寸。否则会先拿兜底尺寸算目标、落位后再飞回来，就是"出界然后再收回"。
    const r = el.getBoundingClientRect();
    if (r.width > 0) setToolbarW((prev) => (prev === r.width ? prev : r.width));
    if (r.height > 0) setToolbarH((prev) => (prev === r.height ? prev : r.height));
  });

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

  /**
   * 目标位置来自 React 的那条通路：选中集合/尺寸变化时更新目标。
   *
   * 位移本身**不再**是"每次换目标重启一段 400ms 缓出飞行"——那会让工具栏在
   * 框选拖动中反复加速/停顿（观感既卡又生硬）。现在只有一条连续的弹簧跟随，
   * 目标可以随时被覆盖（拖动期甚至逐帧覆盖，见 onBodyPointerMove）。
   */
  useLayoutEffect(() => {
    /**
     * 框选进行中：目标只由"逐帧实时命中包围盒"那一路写。
     *
     * React 这一路的 selGeom 是按提交后的 selectedIds 算的，而拖动期提交被节流
     * 到 90ms，因此它写下的往往是**上一段落点**；两路交替写会把工具栏来回拽，
     * 观感就是"把经过的每个落点都执行一遍"而不是追踪当前落点。
     */
    if (marqueeStartRef.current) return;
    if (!toolbarTarget) {
      if (toolbarAnimRef.current) {
        cancelAnimationFrame(toolbarAnimRef.current.raf);
        toolbarAnimRef.current = null;
      }
      toolbarTargetRef.current = null;
      toolbarPosRef.current = null;
      toolbarLastTsRef.current = 0;
      return;
    }
    setToolbarTargetNow(toolbarTarget);
    // toolbarHidden 变化时也要让目标重新生效（隐藏期间元素可能被卸载重挂）
  }, [toolbarTarget, toolbarHidden, setToolbarTargetNow]);

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
    marqueeToolbarSuppressed: !!marquee && !hadToolbarRef.current,
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
      toolbarLastTsRef.current = 0;
    },
    bumpSelGeomTick: () => setSelGeomTick((v) => v + 1),
  };
}
