import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { arrayMove } from "@dnd-kit/sortable";
import type { Block, EffectItem, SideSection, ViewMode } from "../lib/model";
import { accentStyle, buildSemanticUnits, type BandPatch } from "../lib/blocks";
import { useDragSort } from "./useDragSort";
import BandParamCard from "../components/BandParamCard";
import EffectCard from "../components/EffectCard";
import EffectSemanticCard from "../components/EffectSemanticCard";
import SemanticUnitCard from "../components/SemanticUnitCard";

/** 视图切换后内容高度收窄动画时长（ms） */
export const VIEW_COLLAPSE_MS = 800;

interface UseViewAnimationOptions {
  bodyRef: React.RefObject<HTMLDivElement | null>;
  blocks: Block[];
  effects: EffectItem[];
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
  const viewAnimTimerRef = useRef<number | undefined>(undefined);
  const viewTransitionPendingRef = useRef(false);
  const viewEnterDoneRef = useRef(false);
  const viewExitDoneRef = useRef(false);
  const viewTransitionTokenRef = useRef(0);
  const viewCollapseTimerRef = useRef<number | undefined>(undefined);
  const viewScrollTopRef = useRef(0);
  const viewHeightLockRef = useRef(false);
  const viewRef = useRef(view);
  const viewAnimatingRef = useRef(viewAnimating);
  viewAnimatingRef.current = viewAnimating;

  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  useEffect(() => () => {
    window.clearTimeout(viewAnimTimerRef.current);
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

  const finishViewAnim = useCallback((token: number) => {
    if (token !== viewTransitionTokenRef.current) return;
    window.clearTimeout(viewAnimTimerRef.current);
    window.clearTimeout(viewCollapseTimerRef.current);
    viewTransitionPendingRef.current = false;
    // 只有锁定过高度时才执行收窄动画。
    if (viewHeightLockRef.current) {
      setViewTransitionH(0);
      setViewCollapsing(true);
    } else {
      setViewTransitionH(null);
      setViewCollapsing(false);
    }
    setViewAnimating(false);
    // 平移动画结束后立即重测几何并让浮窗出场；高度收窄仍在后台继续。
    // 收窄期间若发生滚动，scroll 监听会继续重测，浮窗不会跟丢。
    bumpSelGeomTickRef.current();
    window.setTimeout(() => {
      if (token !== viewTransitionTokenRef.current) return;
      setToolbarHidden(false);
    }, 0);
    viewCollapseTimerRef.current = window.setTimeout(() => {
      if (token !== viewTransitionTokenRef.current) return;
      setViewCollapsing(false);
    }, VIEW_COLLAPSE_MS);
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
    window.clearTimeout(viewCollapseTimerRef.current);
    cancelToolbarAnimRef.current();
    const body = bodyRef.current;
    if (body) {
      // 无论旧内容是否可滚动，都记录当前滚动位置；
      // 低→高切换时旧 scrollTop 为 0，恢复后仍停在新视图顶部。
      viewScrollTopRef.current = body.scrollTop;
      // 仅当旧内容确实可滚动时才锁高并收窄；否则不要硬加一段高度动画。
      viewHeightLockRef.current = body.scrollHeight > body.clientHeight + 1;
      if (viewHeightLockRef.current) {
        // 只取 view-stack 的内容高度，而不是整个滚动容器的 scrollHeight；
        // 这样过渡期间的滚动条长度是 max(旧内容, 新内容)，不会先变短再变长。
        const stack = body.querySelector<HTMLElement>(".view-stack");
        const stackH = stack ? Math.round(stack.getBoundingClientRect().height) : 0;
        setViewTransitionH(stackH);
      } else {
        setViewTransitionH(null);
      }
      setViewCollapsing(false);
    }
    setViewAnimating(true);
    setToolbarHidden(true);
    // 兜底：正常情况下由进场 onAnimationComplete + 退场 onExitComplete
    // 共同触发 finishViewAnim；若极端卡顿导致回调未触发，1200ms 后强制收尾。
    viewAnimTimerRef.current = window.setTimeout(() => finishViewAnim(token), 1200);
  }, [finishViewAnim, cancelToolbarAnimRef]);

  const handlePresetStageComplete = useCallback(() => {
    if (viewRef.current === "preset") {
      viewEnterDoneRef.current = true;
      tryFinishViewAnim();
    }
  }, [tryFinishViewAnim]);

  const handleAdvancedStageComplete = useCallback(() => {
    if (viewRef.current === "advanced") {
      viewEnterDoneRef.current = true;
      tryFinishViewAnim();
    }
  }, [tryFinishViewAnim]);

  const handleViewExitComplete = useCallback(() => {
    viewExitDoneRef.current = true;
    tryFinishViewAnim();
  }, [tryFinishViewAnim]);

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
        ? `group-card standalone${b.enabled ? " enabled" : " disabled"}${b.group ? " sem-group" : ""}`
        : `band-card${b.enabled ? " enabled" : " disabled"}${b.group ? " sem-group" : ""}`;
    },
    [blocks, view],
  );

  // 拖拽悬浮/飞行副本携带组配色，组名+叉的 chip 使用真实组色
  const overlayStyleForKey = useCallback(
    (key: string): React.CSSProperties | undefined => {
      const b = blocks.find((x) => x.id === key);
      if (!b) return undefined;
      const style = accentStyle(accentOfRef.current(b));
      // preset 沿用原逻辑（全部带组色）；参数视图只有组卡片带组色
      return view === "preset" || b.group ? style : undefined;
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
    viewRef,
    viewAnimatingRef,
    switchView,
    beginViewAnim,
    handlePresetStageComplete,
    handleAdvancedStageComplete,
    handleViewExitComplete,
    blocksDragApi,
    effectsDragApi,
    overlayClassForKey,
    overlayStyleForKey,
    effectOverlayClassForKey,
    effectOverlayContent,
  };
}
