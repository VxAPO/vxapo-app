import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { arrayMove } from "@dnd-kit/sortable";
import type { Block, EffectItem, SideSection, ViewMode } from "../lib/model";
import { accentStyle, buildSemanticUnits, type BandPatch } from "../lib/blocks";
import { useDragSort } from "./useDragSort";
import BandParamCard from "../components/BandParamCard";
import EffectCard from "../components/EffectCard";
import EffectSemanticCard from "../components/EffectSemanticCard";
import SemanticUnitCard from "../components/SemanticUnitCard";
import {
  COLLAPSE_SNAP_PX,
  VIEW_COLLAPSE_MS,
  VIEW_SLIDE_MS,
  heightDeltaMs,
} from "../lib/viewMotion";

// 时序契约常量集中放在 lib/viewMotion.ts（App 与本文件共用），这里只做兼容导出
export { VIEW_COLLAPSE_MS, VIEW_SLIDE_MS };

interface UseViewAnimationOptions {
  bodyRef: React.RefObject<HTMLDivElement | null>;
  blocks: Block[];
  effects: EffectItem[];
  /** 事件期读取（框选集合）——由 App 在 hook 后填充，绕 opening 顺序/依赖环。 */
  selectedIdsRef: React.MutableRefObject<string[]>;
  setBlocks: React.Dispatch<React.SetStateAction<Block[]>>;
  setEffects: React.Dispatch<React.SetStateAction<EffectItem[]>>;
  channelNames: string[];
  markDirty: () => void;
  removeBlock: (idx: number) => void;
  removeGroup: (label: string) => void;
  patchBlock: (idx: number, patch: Partial<Block>) => void;
  patchBand: (blockIdx: number, bandIdx: number, patch: BandPatch) => void;
  toggleEffect: (id: string) => void;
  removeEffect: (id: string) => void;
  patchEffectSemantic: (id: string, strength: number) => void;
  patchEffectParam: (id: string, key: string, value: number | string) => void;
  /** 事件期读取（拖拽 overlay 配色），由 App 在预设 hook 后填充。 */
  accentOfRef: React.MutableRefObject<(b: Block) => string>;
  /** 事件期调用（beginViewAnim 取消工具栏动画），由 marquee hook 填充。 */
  cancelToolbarAnimRef: React.MutableRefObject<() => void>;
  /** 事件期调用（finishViewAnim 重测几何），由 marquee hook 填充。 */
  bumpSelGeomTickRef: React.MutableRefObject<() => void>;
}

/** 预设/高级视图切换动画 + 拖拽 API + 悬浮 overlay 内容。 */
export function useViewAnimation({
  bodyRef,
  blocks,
  effects,
  selectedIdsRef,
  setBlocks,
  setEffects,
  channelNames,
  markDirty,
  removeBlock,
  removeGroup,
  patchBlock,
  patchBand,
  toggleEffect,
  removeEffect,
  patchEffectSemantic,
  patchEffectParam,
  accentOfRef,
  cancelToolbarAnimRef,
  bumpSelGeomTickRef,
}: UseViewAnimationOptions) {
  const [view, setView] = useState<ViewMode>("preset");
  const [side, setSide] = useState<SideSection>("preset");
  const [segDir, setSegDir] = useState<"left" | "right">("right");
  const [viewAnimating, setViewAnimating] = useState(false);
  const [toolbarHidden, setToolbarHidden] = useState(false);
  const [viewTransitionH, setViewTransitionH] = useState<number | null>(null);
  const [viewCollapsing, setViewCollapsing] = useState(false);
  /** 本次收窄实际使用的时长（按高度差缩放），供 App 拼 transition 用 */
  const [viewCollapseMs, setViewCollapseMs] = useState(VIEW_COLLAPSE_MS);
  /**
   * 滚动条长度变形指令：切到「更高的新内容」时下发（见下面的 useLayoutEffect）。
   * token 变化即触发一次变形，ms 与收窄同一套高度差换算。
   */
  const [viewMorph, setViewMorph] = useState<{ token: number; ms: number } | null>(null);
  /**
   * 非当前视图的显隐：切换完成后把它 display:none，两套视图常驻 DOM 但只有当前视图参与
   * 布局与绘制，于是反复切换不再重建 31 张卡的 DOM（挂载尖峰消失）。
   */
  const [hiddenStage, setHiddenStage] = useState<ViewMode | null>("advanced");
  const viewAnimTimerRef = useRef<number | undefined>(undefined);
  const viewTransitionPendingRef = useRef(false);
  const viewEnterDoneRef = useRef(false);
  const viewExitDoneRef = useRef(false);
  const viewTransitionTokenRef = useRef(0);
  /** 平移结束那一刻启动收窄的定时器（不依赖动画完成回调，避免晚 1 帧）。 */
  const viewCollapseStartTimerRef = useRef<number | undefined>(undefined);
  /** 收窄结束、清掉 min-height 的定时器。 */
  const viewCollapseTimerRef = useRef<number | undefined>(undefined);
  const viewScrollTopRef = useRef(0);
  const viewHeightLockRef = useRef(false);
  /** 旧内容高度（px，无论是否锁高都记）：收窄算差值、变高算变形时长都用它 */
  const viewLockHeightRef = useRef(0);
  const viewRef = useRef(view);
  const viewAnimatingRef = useRef(viewAnimating);
  viewAnimatingRef.current = viewAnimating;

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  useEffect(() => () => {
    window.clearTimeout(viewAnimTimerRef.current);
    window.clearTimeout(viewCollapseStartTimerRef.current);
    window.clearTimeout(viewCollapseTimerRef.current);
  }, []);

  // 动画结束、新视图稳定后，在 paint 前恢复原滚动位置。
  useLayoutEffect(() => {
    if (viewAnimating) return;
    const body = bodyRef.current;
    if (body && viewScrollTopRef.current > 0) {
      body.scrollTop = viewScrollTopRef.current;
    }
  }, [viewAnimating]);

  /**
   * 启动高度收窄。由「切换后 VIEW_SLIDE_MS」的定时器触发，正好落在平移最后一帧上，
   * 不再等 framer-motion 的动画完成回调（回调会晚 1 帧，观感就是平移完了先停一下再滚）。
   */
  const startCollapse = useCallback(
    (token: number) => {
      if (token !== viewTransitionTokenRef.current) return;
      if (!viewHeightLockRef.current) {
        setViewTransitionH(null);
        setViewCollapsing(false);
        return;
      }
      // 终点必须是新视图的**自然高度**，不能是 0：
      // min-height 只在「大于内容高度」时才影响渲染高度，终点给 0 的话，
      // 高度动画走到新内容高度那一刻就停了——高度差越小，这段可见动画占比越小，
      // 看起来就像瞬移。终点给新内容高度，收窄才会按 800ms 完整走完。
      const stage = bodyRef.current?.querySelector<HTMLElement>(
        ".view-stage.is-active",
      );
      const naturalH = stage ? Math.round(stage.getBoundingClientRect().height) : 0;
      const delta = viewLockHeightRef.current - naturalH;
      if (delta < COLLAPSE_SNAP_PX) {
        // 差值小到看不出来（含向上变高）：直接对齐，别用 800ms 换一段空等
        setViewTransitionH(null);
        setViewCollapsing(false);
        return;
      }
      const ms = heightDeltaMs(delta);
      setViewCollapseMs(ms);
      setViewTransitionH(naturalH);
      setViewCollapsing(true);
      viewCollapseTimerRef.current = window.setTimeout(() => {
        if (token !== viewTransitionTokenRef.current) return;
        setViewCollapsing(false);
        // 收窄结束就撤掉 min-height：否则之后内容变矮时会被这段残留高度撑住
        setViewTransitionH(null);
      }, ms);
    },
    [bodyRef],
  );

  const finishViewAnim = useCallback((token: number) => {
    if (token !== viewTransitionTokenRef.current) return;
    window.clearTimeout(viewAnimTimerRef.current);
    viewTransitionPendingRef.current = false;
    setViewAnimating(false);
    // 平移动画结束后立即重测几何并让浮窗出场；高度收窄仍在后台继续。
    // 收窄期间若发生滚动，scroll 监听会继续重测，浮窗不会跟丢。
    bumpSelGeomTickRef.current();
    window.setTimeout(() => {
      if (token !== viewTransitionTokenRef.current) return;
      setToolbarHidden(false);
    }, 0);
  }, [bumpSelGeomTickRef]);

  const tryFinishViewAnim = useCallback(() => {
    if (!viewTransitionPendingRef.current) return;
    if (viewEnterDoneRef.current && viewExitDoneRef.current) {
      finishViewAnim(viewTransitionTokenRef.current);
    }
  }, [finishViewAnim]);

  const beginViewAnim = useCallback(() => {
    const token = viewTransitionTokenRef.current + 1;
    viewTransitionTokenRef.current = token;
    viewTransitionPendingRef.current = true;
    viewEnterDoneRef.current = false;
    viewExitDoneRef.current = false;
    window.clearTimeout(viewAnimTimerRef.current);
    window.clearTimeout(viewCollapseStartTimerRef.current);
    window.clearTimeout(viewCollapseTimerRef.current);
    cancelToolbarAnimRef.current();
    const body = bodyRef.current;
    if (body) {
      // 无论旧内容是否可滚动，都记录当前滚动位置；
      // 低→高切换时旧 scrollTop 为 0，恢复后仍停在新视图顶部。
      viewScrollTopRef.current = body.scrollTop;
      // 仅当旧内容确实可滚动时才锁高并收窄；否则不要硬加一段高度动画。
      viewHeightLockRef.current = body.scrollHeight > body.clientHeight + 1;
      // 只取 view-stack 的内容高度，而不是整个滚动容器的 scrollHeight；
      // 这样过渡期间的滚动条长度是 max(旧内容, 新内容)，不会先变短再变长。
      // 不锁高时也要记下来：变高方向要靠新旧高度差算滚动条变形时长。
      const stack = body.querySelector<HTMLElement>(".view-stack");
      const stackH = stack
        ? Math.round(stack.getBoundingClientRect().height)
        : 0;
      viewLockHeightRef.current = stackH;
      setViewTransitionH(viewHeightLockRef.current && stackH ? stackH : null);
      setViewCollapsing(false);
    }
    setViewAnimating(true);
    setToolbarHidden(true);
    // 平移正好结束时启动收窄（同一 task 内量高度 + 设终点），与平移动画严格对齐
    viewCollapseStartTimerRef.current = window.setTimeout(
      () => startCollapse(token),
      VIEW_SLIDE_MS,
    );
    // 兜底：正常情况下由进场 onAnimationComplete + 退场 onExitComplete
    // 共同触发 finishViewAnim；若极端卡顿导致回调未触发，1200ms 后强制收尾。
    viewAnimTimerRef.current = window.setTimeout(() => finishViewAnim(token), 1200);
  }, [finishViewAnim, startCollapse, cancelToolbarAnimRef]);

  /** 视图变化时把新视图从 display:none 放出来（退场那套在动画结束后再收起来）。 */
  useEffect(() => {
    setHiddenStage((h) => (h === view ? null : h));
  }, [view]);

  /**
   * 切到「更高的新内容」时，补一次滚动条长度变形。
   *
   * 变高方向 min-height 压不住内容，收窄分支必然走「直接对齐」（见 startCollapse），
   * 于是滚动条长度在布局提交那一帧硬跳；而变矮方向长度是跟着收窄动画逐帧走的。
   * 这里在布局提交后、绘制前量出新视图自然高度，把同一套「高度差→时长」换算交给
   * 滚动条自己做插值，两个方向的观感才对得上（时长/曲线与收窄完全同源）。
   */
  useLayoutEffect(() => {
    if (!viewTransitionPendingRef.current) return;
    if (!viewLockHeightRef.current) return; // 没量到旧内容高度就不派（首帧/异常）
    const stage = bodyRef.current?.querySelector<HTMLElement>(
      ".view-stage.is-active",
    );
    if (!stage) return;
    const grew =
      Math.round(stage.getBoundingClientRect().height) - viewLockHeightRef.current;
    if (grew < COLLAPSE_SNAP_PX) return; // 没变高：走收窄或直接对齐
    setViewMorph({ token: viewTransitionTokenRef.current, ms: heightDeltaMs(grew) });
  }, [view, bodyRef]);

  /** 单个 stage 的动画结束：当前视图=进场完成；另一套=退场完成，收进 display:none。 */
  const handleStageAnimationComplete = useCallback(
    (v: ViewMode) => {
      if (v === viewRef.current) {
        viewEnterDoneRef.current = true;
        tryFinishViewAnim();
        return;
      }
      setHiddenStage(v);
      viewExitDoneRef.current = true;
      tryFinishViewAnim();
    },
    [tryFinishViewAnim],
  );

  /** 首屏空闲后再挂载另一套视图，避免拖慢第一帧。 */
  const [stageWarm, setStageWarm] = useState(false);
  useEffect(() => {
    const ric = (
      window as unknown as {
        requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      }
    ).requestIdleCallback;
    if (ric) {
      const id = ric(() => setStageWarm(true), { timeout: 600 });
      return () => {
        (
          window as unknown as { cancelIdleCallback?: (id: number) => void }
        ).cancelIdleCallback?.(id);
      };
    }
    const t = window.setTimeout(() => setStageWarm(true), 350);
    return () => window.clearTimeout(t);
  }, []);

  const overlayContent = useCallback(
    (key: string, num: number): ReactNode => {
      const bi = blocks.findIndex((b) => b.id === key);
      const b = bi >= 0 ? blocks[bi] : undefined;
      if (!b) return null;
      if (view === "preset") {
        return (
          <SemanticUnitCard
            block={b}
            index={bi}
            groupLabel={b.group}
            dragNum={null}
            num={num}
            onRemoveBlock={removeBlock}
            onRemoveGroup={removeGroup}
            onPatchBlock={patchBlock}
            onPatchBand={patchBand}
          />
        );
      }
      return (
        <BandParamCard
          block={b}
          index={bi}
          dragNum={null}
          num={num}
          onRemoveBlock={removeBlock}
          onPatchBlock={patchBlock}
          onPatchBand={patchBand}
        />
      );
    },
    [blocks, view, removeBlock, removeGroup, patchBlock, patchBand],
  );

  const commitBlockOrder = useCallback(
    (key: string, target: number) => {
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
          if (oi < 0) return prev;
          const first = channelNames[0] ?? "L";
          const ch = prev[oi].channel ?? first;
          const idxs: number[] = [];
          prev.forEach((b, i) => {
            if ((b.channel ?? first) === ch) idxs.push(i);
          });
          const oPos = idxs.indexOf(oi);
          if (oPos < 0 || oPos === target) return prev;
          const moved = arrayMove(idxs, oPos, target);
          const next = [...prev];
          moved.forEach((src, pos) => {
            next[idxs[pos]] = prev[src];
          });
          return next;
        });
      }
    },
    [setBlocks, channelNames],
  );

  const commitEffectOrder = useCallback(
    (key: string, target: number) => {
      setEffects((prev) => {
        const oi = prev.findIndex((e) => `e-${e.id ?? e.type}` === key);
        if (oi < 0 || oi === target) return prev;
        return arrayMove(prev, oi, target);
      });
    },
    [setEffects],
  );

  const effectOverlayContent = useCallback(
    (key: string, _num: number): ReactNode => {
      const id = key.slice(2);
      const e = effects.find((x) => (x.id ?? x.type) === id);
      if (!e) return null;
      if (view === "preset") {
        return (
          <EffectSemanticCard
            effect={e}
            onToggle={toggleEffect}
            onRemove={removeEffect}
            onStrengthChange={patchEffectSemantic}
          />
        );
      }
      return (
        <EffectCard
          effect={e}
          onToggle={toggleEffect}
          onRemove={removeEffect}
          onChangeParam={patchEffectParam}
        />
      );
    },
    [effects, view, toggleEffect, removeEffect, patchEffectSemantic, patchEffectParam],
  );

  const blocksDragApi = useDragSort({
    group: "bands",
    markDirty,
    overlayContent,
    commitOrder: commitBlockOrder,
  });
  const effectsDragApi = useDragSort({
    group: "effects",
    markDirty,
    overlayContent: effectOverlayContent,
    commitOrder: commitEffectOrder,
  });

  const overlayClassForKey = useCallback(
    (key: string): string => {
      const b = blocks.find((x) => x.id === key);
      if (!b) return "group-card";
      return view === "preset"
        ? `group-card standalone${b.enabled ? " enabled" : " disabled"}${b.group ? " sem-group" : ""}${selectedIdsRef.current.includes(key) ? " is-selected" : ""}`
        : `band-card${b.enabled ? " enabled" : " disabled"}${b.group ? " sem-group" : ""}${selectedIdsRef.current.includes(key) ? " is-selected" : ""}`;
    },
    [blocks, view, selectedIdsRef],
  );

  // 拖拽悬浮/飞行副本携带组配色，组名+叉的 chip 使用真实组色
  const overlayStyleForKey = useCallback(
    (key: string): React.CSSProperties | undefined => {
      const b = blocks.find((x) => x.id === key);
      if (!b) return undefined;
      const style = accentStyle(accentOfRef.current(b));
      // preset 沿用原逻辑（全部带组色）；参数视图只有组卡片带组色
      // 只有组卡片带组色；无组卡不设 --card-accent，描边回退到品牌色
      return b.group ? style : undefined;
    },
    [view, blocks, accentOfRef],
  );

  const effectOverlayClassForKey = useCallback(
    (key: string): string => {
      const e = effects.find((x) => `e-${x.id ?? x.type}` === key);
      return `effect-card${e ? (e.enabled ? " enabled" : " disabled") : ""}`;
    },
    [effects],
  );

  const switchView = useCallback(
    (v: ViewMode) => {
      if (v === view) return; // 重复点击当前视图不触发进场/退场动画
      beginViewAnim();
      blocksDragApi.cancelDrag();
      effectsDragApi.cancelDrag();
      setSegDir(v === "advanced" ? "right" : "left");
      setView(v);
    },
    [view, beginViewAnim, blocksDragApi.cancelDrag, effectsDragApi.cancelDrag],
  );

  return {
    view,
    setView,
    side,
    setSide,
    segDir,
    setSegDir,
    viewAnimating,
    toolbarHidden,
    viewTransitionH,
    viewCollapsing,
    viewCollapseMs,
    viewMorph,
    viewRef,
    viewAnimatingRef,
    switchView,
    beginViewAnim,
    handleStageAnimationComplete,
    hiddenStage,
    stageWarm,
    blocksDragApi,
    effectsDragApi,
    overlayClassForKey,
    overlayStyleForKey,
    effectOverlayClassForKey,
    effectOverlayContent,
  };
}
