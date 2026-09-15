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
 * 工具栏位移动画时长（ms）与缓动指数。
 *
 * 原来用 easeOutQuart（指数 4）：起始斜率 4，一上来就猛起步再慢慢收，
 * 观感"冲、不优雅"。降到 2.6（比 easeOutCubic 略缓）并把时长放宽到 480ms，
 * 起步变柔、收尾更软；指数就是这里唯一的"优雅度"旋钮（越小越缓）。
 * 注意：拖动期目标是逐帧重规划的，指数同时决定跟随滞后 ≈ 时长/指数
 * （4/400ms ≈ 100ms；2.6/480ms ≈ 185ms，更"黏"一些）。
 */
const TOOLBAR_FLIGHT_MS = 480;
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
    ctrl: { x: number; y: number };
    to: { x: number; y: number };
    t0: number;
  } | null>(null);
  /** 最新目标与当前显示位置 / 速度：事件期直接写 ref，不经过 React 提交节流 */
  const toolbarTargetRef = useRef<{ x: number; y: number } | null>(null);
  const toolbarPosRef = useRef<{ x: number; y: number } | null>(null);
  const toolbarVelRef = useRef({ x: 0, y: 0 });
  const toolbarLastTsRef = useRef(0);
  const toolbarBoundElRef = useRef<HTMLDivElement | null>(null);

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
    const start = {
      x: parseFloat(node0.style.left) || target0.x,
      y: parseFloat(node0.style.top) || target0.y,
    };
    const dx = target0.x - start.x;
    const dy = target0.y - start.y;
    const len = Math.hypot(dx, dy) || 1;
    // 垂直主导走直线；水平主导保留左右开度弧线（与原实现一致）
    const ctrl =
      Math.abs(dy) > Math.abs(dx)
        ? { x: (start.x + target0.x) / 2, y: (start.y + target0.y) / 2 }
        : {
            x: start.x + (dx < 0 ? -1 : 1) * Math.min(220, len * 0.4),
            y: start.y,
          };
    const t0 = performance.now();
    const step = () => {
      const node = toolbarElRef.current;
      const anim = toolbarAnimRef.current;
      if (!node || !anim) {
        toolbarAnimRef.current = null;
        toolbarLastTsRef.current = 0;
        return;
      }
      const t = Math.min(1, (performance.now() - anim.t0) / TOOLBAR_FLIGHT_MS);
      const k = 1 - Math.pow(1 - t, TOOLBAR_FLIGHT_EASE_POW);
      const inv = 1 - k;
      const x = inv * inv * anim.start.x + 2 * inv * k * anim.ctrl.x + k * k * anim.to.x;
      const y = inv * inv * anim.start.y + 2 * inv * k * anim.ctrl.y + k * k * anim.to.y;
      node.style.left = `${snapPx(x)}px`;
      node.style.top = `${snapPx(y)}px`;
      if (t < 1) {
        anim.raf = requestAnimationFrame(step);
      } else {
        toolbarAnimRef.current = null;
        toolbarLastTsRef.current = 0;
        node.style.left = `${anim.to.x}px`;
        node.style.top = `${anim.to.y}px`;
      }
    };
    toolbarAnimRef.current = { raf: requestAnimationFrame(step), start, ctrl, to: target0, t0 };
  }, []);

  /** 事件期/React 期通用的目标更新入口 */
  const setToolbarTargetNow = useCallback(
    (t: { x: number; y: number }) => {
      toolbarTargetRef.current = t;
      const node = toolbarElRef.current;
      if (!node) return;
      if (toolbarBoundElRef.current !== node || !toolbarPosRef.current) {
        // 首次出现（或元素重挂载）：直接就位，不做飞行
        toolbarBoundElRef.current = node;
        toolbarPosRef.current = { x: snapPx(t.x), y: snapPx(t.y) };
        toolbarVelRef.current = { x: 0, y: 0 };
        node.style.left = `${snapPx(t.x)}px`;
        node.style.top = `${snapPx(t.y)}px`;
        return;
      }
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
            // 工具栏跟随：拖动期直接逐帧喂目标（绕开 React 提交节流）。
            // 目标一律取**选中卡片的包围盒**，与 React 那条通路完全同源；
            // 没命中卡片时保持上一个目标（拖动期不清空选择，见下）。
            if (hadToolbarRef.current && toolbarElRef.current && hit.box) {
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
      if (t instanceof Element && t.closest(".sel-copy")) return;
      setCopyOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [copyOpen]);

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

  /**
   * 目标位置来自 React 的那条通路：选中集合/尺寸变化时更新目标。
   *
   * 位移本身**不再**是"每次换目标重启一段 400ms 缓出飞行"——那会让工具栏在
   * 框选拖动中反复加速/停顿（观感既卡又生硬）。现在只有一条连续的弹簧跟随，
   * 目标可以随时被覆盖（拖动期甚至逐帧覆盖，见 onBodyPointerMove）。
   */
  useLayoutEffect(() => {
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
