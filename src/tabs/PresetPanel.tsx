import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Trash2 } from "lucide-react";
import type { ModuleInstance, Preset } from "../types";
import { presetById } from "../data/presets";
import PresetCard from "../components/PresetCard";

interface PresetPanelProps {
  presets: Preset[];
  modules: ModuleInstance[];
  onAdd: (presetId: string, index?: number) => void;
  onIntensity: (index: number, value: number) => void;
  onRemove: (index: number) => void;
  onRemoveMany: (ids: string[]) => void;
  onReorder: (from: number, to: number) => void;
}

interface DragState {
  kind: "favorite" | "module";
  presetId?: string;
  index?: number;
  startX: number;
  startY: number;
  active: boolean;
  phase: "pending" | "picking" | "dragging";
  x: number;
  y: number;
}

interface LandingState {
  key: number;
  index: number;
  from: { x: number; y: number; dx: number; dy: number } | null;
  kind: "click" | "drop";
}

export default function PresetPanel({
  presets,
  modules,
  onAdd,
  onIntensity,
  onRemove,
  onRemoveMany,
  onReorder,
}: PresetPanelProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const phaseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pitchRef = useRef(64);
  const cardHeightRef = useRef(52);
  const listWidthRef = useRef(1248);

  const [drag, setDrag] = useState<DragState | null>(null);
  const [tempPos, setTempPos] = useState<number | null>(null);
  const [deleteHot, setDeleteHot] = useState(false);
  const [returningIndex, setReturningIndex] = useState<number | null>(null);
  const [revealIndex, setRevealIndex] = useState<number | null>(null);
  const [landings, setLandings] = useState<LandingState[]>([]);
  const landingKeyRef = useRef(0);
  const [deletePhase, setDeletePhase] = useState<"idle" | "ghost" | "zone">("idle");
  const deletePhaseRef = useRef(deletePhase);
  deletePhaseRef.current = deletePhase;
  const [deleteHotSettled, setDeleteHotSettled] = useState(false);
  const [phSettled, setPhSettled] = useState(true);
  const phPrevPosRef = useRef<number | null>(null);
  const landingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 框选 / 群组拖拽
  const [selBox, setSelBox] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deletingSelected, setDeletingSelected] = useState(false);
  const [removingSelected, setRemovingSelected] = useState<Set<string> | null>(null);
  // 松手后若位移动画未完成，等待其完成再提交放置。
  const settlingRef = useRef(false);
  const lastShiftAtRef = useRef(0);

  // 事件处理用最新状态（window 监听只挂一次）。
  const dragRef = useRef(drag);
  dragRef.current = drag;
  const tempPosRef = useRef(tempPos);
  tempPosRef.current = tempPos;
  const modulesRef = useRef(modules);
  modulesRef.current = modules;

  const clearTimers = () => {
    if (phaseTimer.current) {
      clearTimeout(phaseTimer.current);
      phaseTimer.current = null;
    }
  };

  const scheduleLandingRemove = (key: number, ms: number) => {
    landingTimerRef.current = setTimeout(() => {
      landingTimerRef.current = null;
      setLandings((prev) => prev.filter((l) => l.key !== key));
    }, ms);
  };

  const pushLanding = (index: number, from: LandingState["from"], kind: "click" | "drop") => {
    const key = ++landingKeyRef.current;
    setLandings((prev) => [...prev, { key, index, from, kind }]);
    scheduleLandingRemove(key, 1100);
  };

  // 测量卡片高度与间距，拖拽期间按固定行距做位移动画。
  const measureSlotMetrics = () => {
    const list = listRef.current;
    if (!list) return;
    const card = list.querySelector<HTMLElement>(".module-card");
    const cs = getComputedStyle(list);
    const gap = parseFloat(cs.rowGap || cs.gap) || 12;
    const cardH = card?.offsetHeight ?? 52;
    cardHeightRef.current = cardH;
    pitchRef.current = cardH + gap;
    listWidthRef.current = list.clientWidth - 32;
  };

  const smoothScrollTo = (list: HTMLDivElement, target: number, dur = 320) => {
    const start = list.scrollTop;
    const distance = target - start;
    if (Math.abs(distance) < 0.5) return;
    const t0 = performance.now();
    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      const y = start + distance * eased;
      list.scrollTop = Math.min(Math.max(0, y), list.scrollHeight - list.clientHeight);
      if (Math.abs(list.scrollTop - target) > 0.5 && performance.now() - t0 < 1500) {
        requestAnimationFrame(step);
      }
    };
    requestAnimationFrame(step);
  };

  // 记录落点相对卡片最终槽位的偏移，让卡片从落点飞入槽位。
  const computeFrom = (clientX: number, clientY: number, index: number, scrollTopOverride?: number) => {
    const list = listRef.current;
    if (!list) return null;
    const rect = list.getBoundingClientRect();
    const padTop = parseFloat(getComputedStyle(list).paddingTop) || 0;
    const scrollTop = scrollTopOverride ?? list.scrollTop;
    const finalCenterX = rect.left + list.clientWidth / 2;
    const finalCenterY = rect.top - scrollTop + padTop + index * pitchRef.current + cardHeightRef.current / 2;
    return {
      x: clientX,
      y: clientY,
      dx: clientX - finalCenterX,
      dy: clientY - finalCenterY,
    };
  };

  const cancelDrag = (withReturn: boolean) => {
    const d = dragRef.current;
    if (withReturn && d?.kind === "module" && d.index !== undefined) {
      setReturningIndex(d.index);
      setTimeout(() => setRevealIndex(d.index!), 350);
      setTimeout(() => {
        setReturningIndex(null);
        setRevealIndex(null);
      }, 700);
    }
    clearTimers();
    setDrag(null);
    setTempPos(null);
    setDeleteHot(false);
    setDeletePhase("idle");
  };

  // Esc 取消。
  useEffect(() => {
    if (!drag) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancelDrag(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drag]);

  // 拖拽中全局抓手光标。
  useEffect(() => {
    document.body.style.cursor = drag?.active ? "grabbing" : "";
    return () => {
      document.body.style.cursor = "";
    };
  }, [drag?.active]);

  // 拖拽期间监听 window 指针事件（源卡片提起来后已从列表消失，不能再依赖它收事件）。
  useEffect(() => {
    if (!drag) return;

    // 根据指针位置计算当前插入槽位（用目标槽位而非动画中的实时位置，避免抖动）。
    const computeHover = (clientY: number) => {
      const list = listRef.current;
      if (!list) return null;
      const rect = list.getBoundingClientRect();
      if (clientY < rect.top || clientY > rect.bottom) return null;
      const d = dragRef.current;
      if (!d) return null;
      const dragIdx = d.kind === "module" ? (d.index ?? -1) : -1;
      const n = modulesRef.current.length;
      const prev = tempPosRef.current ?? (d.kind === "module" ? dragIdx : 0);
      const cs = getComputedStyle(list);
      const padTop = parseFloat(cs.paddingTop) || 0;
      const contentY = clientY - rect.top + list.scrollTop - padTop;
      const targets: number[] = [];
      for (let i = 0; i < n; i++) {
        if (i === dragIdx) continue;
        const f = dragIdx >= 0 && i > dragIdx ? i - 1 : i;
        targets.push(f + (prev <= f ? 1 : 0));
      }
      let hover = targets.length;
      for (let j = 0; j < targets.length; j++) {
        if (contentY < (targets[j] + 0.5) * pitchRef.current) {
          hover = j;
          break;
        }
      }
      const max = dragIdx >= 0 ? n - 1 : n;
      return Math.max(0, Math.min(max, hover));
    };

    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      if (settlingRef.current) return;
      const moved = Math.hypot(e.clientX - d.startX, e.clientY - d.startY);
      const active = d.active || moved > 6;

      let hover: number | null = null;
      let deleting = false;
      if (active) {
        hover = computeHover(e.clientY);
        deleting = Boolean(document.elementFromPoint(e.clientX, e.clientY)?.closest?.(".delete-zone"));
      }

      setDrag((prev) => {
        if (!prev) return prev;
        const next = { ...prev, active, x: e.clientX, y: e.clientY };
        if (active && prev.phase === "pending") {
          next.phase = "picking";
          phaseTimer.current = setTimeout(() => {
            setDrag((p) => (p?.active ? { ...p, phase: "dragging" } : p));
            setTempPos((old) => old ?? prev.index ?? 0);
          }, 150);
        }
        return next;
      });
      if (hover !== null && hover !== tempPosRef.current) {
        lastShiftAtRef.current = performance.now();
      }
      setTempPos((old) => (old === hover ? old : hover));
      setDeleteHot((old) => (old === deleting ? old : deleting));
    };

    const onEnd = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      if (deletePhaseRef.current !== "idle") return;
      if (settlingRef.current) return;
      const wasActive = d.active;
      // 松手瞬间直接按指针位置计算，避免最后一次 move 的状态还没提交导致误判。
      const hover = computeHover(e.clientY);
      const deleting = Boolean(document.elementFromPoint(e.clientX, e.clientY)?.closest?.(".delete-zone"));

      const finish = () => {
        if (!dragRef.current) return;
        let committed = false;
        if (d.kind === "favorite" && d.presetId && hover !== null) {
          onAdd(d.presetId, hover);
          pushLanding(hover, computeFrom(e.clientX, e.clientY, hover), "drop");
          committed = true;
        } else if (d.kind === "module" && d.index !== undefined && hover !== null) {
          onReorder(d.index, hover);
          pushLanding(hover, computeFrom(e.clientX, e.clientY, hover), "drop");
          committed = true;
        }
        cancelDrag(!committed);
      };

      if (wasActive) {
        if (deleting && d.kind === "module" && d.index !== undefined) {
          // 删除动画：幽灵先淡出，随后移除模块，删除槽位再淡出。
          setDeletePhase("ghost");
          // 幽灵淡出期间平滑上滚到删除后的最大滚动位置，避免移除后直接跳变。
          const list = listRef.current;
          if (list) {
            const target = Math.min(list.scrollTop, Math.max(0, list.scrollHeight - list.clientHeight - pitchRef.current));
            smoothScrollTo(list, target, 260);
          }
          setTimeout(() => {
            onRemove(d.index!);
            setDeletePhase("zone");
            setTimeout(() => {
              setDeletePhase("idle");
              setDrag(null);
              setTempPos(null);
              setDeleteHot(false);
              setDeleteHotSettled(false);
            }, 220);
          }, 280);
          return;
        }
        if (hover === null) {
          cancelDrag(true);
          return;
        }
        // 若位移动画还在进行，先让列表稳定到松手位置，再提交放置。
        if (hover !== tempPosRef.current) {
          setTempPos(hover);
          lastShiftAtRef.current = performance.now();
        }
        const wait = Math.max(0, 480 - (performance.now() - lastShiftAtRef.current));
        if (wait > 0) {
          settlingRef.current = true;
          setTimeout(() => {
            settlingRef.current = false;
            finish();
          }, wait);
        } else {
          finish();
        }
      } else if (d.kind === "favorite" && d.presetId) {
        onAdd(d.presetId);
        const idx = modulesRef.current.length;
        // 滚动后槽位的最终视口位置，作为飞行落点（避免飞出底边栏）。
        const list = listRef.current;
        let finalScroll = list?.scrollTop ?? 0;
        if (list) {
          const padTop = parseFloat(getComputedStyle(list).paddingTop) || 0;
          const top = padTop + idx * pitchRef.current;
          const bottom = top + cardHeightRef.current + 16;
          if (top < finalScroll) {
            finalScroll = top;
          } else if (bottom > finalScroll + list.clientHeight) {
            finalScroll = Math.max(0, bottom - list.clientHeight);
          }
        }
        pushLanding(idx, computeFrom(e.clientX, e.clientY, idx, finalScroll), "click");
        cancelDrag(false);
      }
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
    };
  }, [drag]);

  // 卸载时清理计时器。
  useEffect(() => clearTimers, []);

  // 框选：拖出选区时实时更新选中卡片。
  useEffect(() => {
    if (!selBox) return;
    const list = listRef.current;
    const onMove = (e: PointerEvent) => {
      setSelBox((prev) => (prev ? { ...prev, x2: e.clientX, y2: e.clientY } : prev));
      if (!list) return;
      const left = Math.min(selBox.x1, e.clientX);
      const right = Math.max(selBox.x1, e.clientX);
      const top = Math.min(selBox.y1, e.clientY);
      const bottom = Math.max(selBox.y1, e.clientY);
      const ids = new Set<string>();
      list.querySelectorAll<HTMLElement>(".module-card").forEach((card) => {
        const r = card.getBoundingClientRect();
        if (r.left < right && r.right > left && r.top < bottom && r.bottom > top) {
          const id = card.parentElement?.dataset.id;
          if (id) ids.add(id);
        }
      });
      setSelectedIds(ids);
    };
    const onUp = () => {
      setSelBox((prev) => {
        if (prev && Math.abs(prev.x2 - prev.x1) < 10 && Math.abs(prev.y2 - prev.y1) < 10) {
          setSelectedIds(new Set());
        }
        return null;
      });
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [selBox]);

  // 进入删除区域并完成缩小动画后，隐藏占位槽；移出后恢复判定。
  useEffect(() => {
    if (!deleteHot) {
      setDeleteHotSettled(false);
      return;
    }
    const t = setTimeout(() => setDeleteHotSettled(true), 250);
    return () => clearTimeout(t);
  }, [deleteHot]);

  // 新增/放置卡片后，若它超出可视区域，平滑滚动让整张卡片（含强度滑条）可见。
  useEffect(() => {
    const latest = landings[landings.length - 1];
    if (!latest) return;
    // 先滚动到槽位，飞行再从收藏栏出发。
    const timer = setTimeout(() => {
      const list = listRef.current;
      if (!list) return;
      if (!list.querySelectorAll(".module-card")[latest.index]) return;
      const padTop = parseFloat(getComputedStyle(list).paddingTop) || 0;
      // 按卡片最终槽位计算滚动位置，而不是它飞入动画中的起点。
      const top = padTop + latest.index * pitchRef.current;
      const bottom = top + cardHeightRef.current + 16;
      const st = list.scrollTop;
      let target = st;
      if (top < st) {
        target = top;
      } else if (bottom > st + list.clientHeight) {
        target = Math.max(0, bottom - list.clientHeight);
      }
      smoothScrollTo(list, target);
    }, 0);
    return () => clearTimeout(timer);
  }, [landings]);

  // 按下即开始框选（点击空白处松开则清除选择）。
  const onListPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if (dragRef.current) return;
    const t = e.target as HTMLElement;
    if (t.closest(".grip, input, button, .delete-zone")) return;
    setSelBox({ x1: e.clientX, y1: e.clientY, x2: e.clientX, y2: e.clientY });
  };

  const startDrag = (
    e: ReactPointerEvent<HTMLElement>,
    kind: "favorite" | "module",
    presetId?: string,
    index?: number,
  ) => {
    e.preventDefault();
    clearTimers();
    setSelBox(null);
    setSelectedIds(new Set());
    setReturningIndex(null);
    setRevealIndex(null);
    setDeletePhase("idle");
    setDrag({
      kind,
      presetId,
      index,
      startX: e.clientX,
      startY: e.clientY,
      active: false,
      phase: "pending",
      x: e.clientX,
      y: e.clientY,
    });
    setTempPos(null);
    setDeleteHot(false);
    measureSlotMetrics();
  };

  const draggingIdx = drag?.kind === "module" && drag.phase === "dragging" ? drag.index : null;
  const pickingIdx = drag?.kind === "module" && drag.phase === "picking" ? drag.index : null;

  /** 拖拽中的临时插槽：被拖卡片不参与渲染，其余卡片按目标槽位做 y 位移动画。 */
  const dragIdx = drag?.kind === "module" ? (drag.index ?? -1) : -1;
  const reordering =
    deletePhase === "idle" &&
    ((drag?.active && drag.kind === "favorite" && tempPos !== null) ||
      (drag?.active &&
        drag.kind === "module" &&
        drag.phase === "dragging" &&
        drag.index !== undefined)) &&
    !deleteHotSettled;
  const insertPos = reordering ? (tempPos ?? (dragIdx >= 0 ? dragIdx : 0)) : null;
  // 拖拽中的占位框位置；放置（drop）期间保留同一个占位框，不再重复填背景。
  const dropLanding = landings.find((l) => l.kind === "drop");
  const phPos = reordering && insertPos !== null ? insertPos : dropLanding ? dropLanding.index : null;
  // 首次渲染时 ref 尚未写入：只有停在原槽位（或收藏栏拖入首次出现）才有背景色。
  const phFilled =
    phSettled && (phPrevPosRef.current !== null || dragIdx < 0 || insertPos === dragIdx);

  // 占位框初始出现时有背景色；开始移动时背景淡出，停稳后淡入。
  useEffect(() => {
    if (!reordering) {
      phPrevPosRef.current = null;
      return;
    }
    const first = phPrevPosRef.current === null;
    const prev = phPrevPosRef.current;
    phPrevPosRef.current = insertPos;
    if (first) {
      // 拖拽刚开始若已离开原槽位（拖太快），视为移动过，背景先淡出。
      setPhSettled(dragIdx < 0 || insertPos === dragIdx);
      if (dragIdx >= 0 && insertPos !== dragIdx) {
        const t = setTimeout(() => setPhSettled(true), 400);
        return () => clearTimeout(t);
      }
      return;
    }
    if (prev !== insertPos) {
      setPhSettled(false);
      const t = setTimeout(() => setPhSettled(true), 400);
      return () => clearTimeout(t);
    }
  }, [insertPos, reordering, dragIdx]);

  const moveTransition = {
    y: { type: "spring", stiffness: 300, damping: 33, mass: 1 } as const,
    opacity: { duration: 0.18, ease: "easeOut" } as const,
    scale: { duration: 0.18, ease: "easeOut" } as const,
  };
  const clickFlyTransition = {
    opacity: { duration: 0.2, delay: 0.6, ease: "easeOut" } as const,
    scale: { type: "spring", stiffness: 340, damping: 26, delay: 0.58 } as const,
  };

  const ghostPreset =
    drag?.presetId !== undefined
      ? presetById(drag.presetId)
      : drag?.kind === "module" && drag.index !== undefined
        ? presetById(modules[drag.index]?.presetId ?? "")
        : undefined;
  const usedIds = new Set(modules.map((m) => m.presetId));
  const listRect = listRef.current?.getBoundingClientRect();
  const listScrollTop = listRef.current?.scrollTop ?? 0;
  const boxStyle = selBox && listRect
    ? {
        left: Math.min(selBox.x1, selBox.x2) - listRect.left,
        top: Math.min(selBox.y1, selBox.y2) - listRect.top + listScrollTop,
        width: Math.abs(selBox.x2 - selBox.x1),
        height: Math.abs(selBox.y2 - selBox.y1),
      }
    : null;

  return (
    <div
      style={{ display: "contents" }}
      onContextMenu={(e) => {
        if (dragRef.current) {
          e.preventDefault();
          cancelDrag(true);
        }
      }}
    >
      <div className="favorites-bar">
        {presets.map((p) => (
          <div
            key={p.id}
            className={`favorite-item ${usedIds.has(p.id) ? "used" : ""}`}
            onPointerDown={(e) => {
              if (!usedIds.has(p.id)) startDrag(e, "favorite", p.id);
            }}
            onContextMenu={(e) => {
              if (dragRef.current) {
                e.preventDefault();
                cancelDrag(true);
              }
            }}
          >
            <span>{p.icon}</span>
            {p.name}
          </div>
        ))}
      </div>

      <div
        className={`module-list ${modules.length === 0 ? "empty" : ""}`}
        ref={listRef}
        onPointerDown={onListPointerDown}
      >
        {modules.length === 0 && !drag?.active && (
          <span className="empty-hint">从收藏栏拖入或点击添加预设</span>
        )}

        <AnimatePresence>
          {phPos !== null && (
            <motion.div
              key="ph"
              className={`drop-placeholder ${phFilled ? "" : "unfilled"}`}
              style={{
                position: "absolute",
                top: "var(--space-lg)",
                left: "var(--space-lg)",
                right: "var(--space-lg)",
                height: cardHeightRef.current,
              }}
              initial={{ opacity: 0, y: phPos * pitchRef.current }}
              animate={{ opacity: 1, y: phPos * pitchRef.current }}
              exit={{ opacity: 0 }}
              transition={{
                opacity: { duration: 0.15 },
                y: moveTransition.y,
              }}
            />
          )}
        </AnimatePresence>

        {selBox && boxStyle && (
          <div className="sel-box" style={boxStyle} />
        )}

        {landings
          .filter((l) => l.kind === "click")
          .map((l) => (
            <motion.div
              key={`landing-ph-${l.key}`}
              className="drop-placeholder landing-placeholder"
              style={{
                position: "absolute",
                top: `calc(var(--space-lg) + ${l.index * pitchRef.current}px)`,
                left: "50%",
                x: "-50%",
                width: 120,
                height: cardHeightRef.current,
              }}
              initial={{ opacity: 0, width: 120 }}
              animate={{ opacity: 1, width: listWidthRef.current }}
              transition={{
                opacity: { duration: 0.15, delay: 0.5 },
                width: {
                  duration: 0.32,
                  delay: 0.62,
                  ease: [0.4, 0, 0.2, 1],
                },
              }}
            >
              <motion.div
                className="ph-fill"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.25, delay: 0.62 }}
              />
            </motion.div>
          ))}

        {modules.length > 0 && (
          <div
            className="list-end-space"
            style={{
              position: "absolute",
              left: "var(--space-lg)",
              right: "var(--space-lg)",
              top: `calc(var(--space-lg) + ${Math.max(
                0,
                modules.length * pitchRef.current - (pitchRef.current - cardHeightRef.current),
              )}px)`,
              height: "var(--space-lg)",
            }}
          />
        )}

        {modules.map((m, i) => {
          const preset = presets.find((p) => p.id === m.presetId);
          if (!preset) return null;
          // 删除区阶段：删除动作开始前（idle/ghost）隐藏被拖卡片；真正移除后（zone）不再隐藏任何卡片。
          const hidden = deletePhase !== "zone" && draggingIdx === i;
          if (hidden) return null;
          const returning = returningIndex === i;
          const reveal = revealIndex === i;
          const cardLanding = landings.find((l) => l.index === i);
          const isLanding = !!cardLanding;
          const landingFrom = cardLanding?.from ?? null;
          const landingKind = cardLanding?.kind ?? null;
          const baseOffset = (cardLanding?.index ?? i) - m.seq;
          const picking = pickingIdx === i;
          const f = dragIdx >= 0 ? (i > dragIdx ? i - 1 : i) : i;
          // 进入删除区后占位槽消失，剩余卡片自动补齐到被拖卡片的空位。
          // ghost 阶段被拖卡片还在（隐藏），用 f 补齐；zone 阶段已被移除，直接按新下标排列。
          const fillIn =
            (deletePhase === "ghost" || (deletePhase === "idle" && deleteHotSettled)) && dragIdx >= 0;
          const slot =
            fillIn
              ? f
              : reordering && insertPos !== null
                ? f + (insertPos <= f ? 1 : 0)
                : i;
          const isSelected = selectedIds.has(m.id);
          // 放置动画：拖拽时的简略圆角矩形（drop-flyer）负责飞行，卡片在槽位等它到达后放大出现。
          const landingWait = isLanding && landingKind === "drop" && landingFrom
            ? Math.max(0, 600 - (performance.now() - lastShiftAtRef.current))
            : 0;
          const baseY = baseOffset * pitchRef.current;
          const dropAppearDelay = (landingWait + 500) / 1000;
          const removing = removingSelected?.has(m.id) ?? false;
          return (
            <motion.div
              key={`card-${m.id}`}
              data-id={m.id}
              style={{
                position: "absolute",
                top: `calc(var(--space-lg) + ${m.seq * pitchRef.current}px)`,
                left: "var(--space-lg)",
                right: "var(--space-lg)",
                transformOrigin: picking ? "left center" : undefined,
              }}
              initial={
                isLanding && landingFrom
                  ? landingKind === "click"
                    ? { y: baseY, opacity: 0, scale: 0.4 }
                    : {
                        y: baseY,
                        opacity: 0,
                        scale: 0.5,
                      }
                  : reveal
                    ? { opacity: 0, scale: 0.85 }
                    : false
              }
              animate={{
                y: isLanding && landingFrom && landingKind === "drop"
                  ? baseY
                  : (slot - m.seq) * pitchRef.current,
                x: 0,
                opacity: picking || (returning && !reveal)
                  ? 0
                  : removing
                    ? 0
                    : 1,
                scale: picking || (returning && !reveal)
                  ? 0.85
                  : removing
                    ? 0.55
                    : 1,
              }}
              transition={
                removing
                  ? {
                      opacity: { duration: 0.24, ease: "easeIn" },
                      scale: { duration: 0.24, ease: "easeIn" },
                    }
                  : isLanding && landingFrom
                  ? landingKind === "click"
                    ? clickFlyTransition
                    : {
                        y: { duration: 0.2 },
                        opacity: { duration: 0.18, delay: dropAppearDelay, ease: "easeOut" },
                        scale: { type: "spring", stiffness: 340, damping: 26, delay: dropAppearDelay },
                      }
                  : moveTransition
              }
              onAnimationComplete={() => {
                if (picking) {
                  setDrag((p) => (p?.active ? { ...p, phase: "dragging" } : p));
                }
              }}
            >
              <PresetCard
                index={slot}
                preset={preset}
                intensity={m.intensity}
                dragging={false}
                selected={isSelected}
                onChangeIntensity={(v) => onIntensity(i, v)}
                onGripDown={(e) => startDrag(e, "module", undefined, i)}
              />
            </motion.div>
          );
        })}
      </div>

      {landings
        .filter((l) => l.kind === "click" && l.from)
        .map((l) => {
          const preset = presetById(modules[l.index]?.presetId ?? "");
          if (!preset) return null;
          return (
            <motion.div
              key={`flyer-${l.key}`}
              className="drag-flyer"
              style={{ left: l.from!.x, top: l.from!.y }}
              transformTemplate={(_, generated) => `translate(-50%, -50%) ${generated}`}
              initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
              animate={{
                x: [0, -l.from!.dx],
                y: [0, -l.from!.dy],
                opacity: [1, 1, 0],
              }}
              transition={{
                x: { duration: 0.62, ease: [0.16, 1, 0.3, 1] },
                y: { duration: 0.62, ease: [0.32, 0.82, 0.32, 1] },
                opacity: { duration: 0.62, times: [0, 0.75, 1], ease: "linear" },
              }}
            >
              <span>{preset.icon}</span>
            </motion.div>
          );
        })}

      {landings
        .filter((l) => l.kind === "drop" && l.from)
        .map((l) => {
          const preset = presetById(modules[l.index]?.presetId ?? "");
          if (!preset) return null;
          const waitMs = Math.max(0, 600 - (performance.now() - lastShiftAtRef.current));
          const fadeInMs = 100;
          const flyMs = 380;
          const fadeOutMs = 150;
          const flyStart = waitMs + fadeInMs;
          const total = flyStart + flyMs + fadeOutMs;
          const seg = [0, fadeInMs / total, flyStart / total, (flyStart + flyMs) / total, 1];
          return (
            <motion.div
              key={`drop-flyer-${l.key}`}
              className="drag-ghost"
              style={{ left: l.from!.x, top: l.from!.y }}
              transformTemplate={(_, generated) => `translate(-50%, -50%) ${generated}`}
              initial={{ x: 0, y: 0, opacity: 0, scale: 1 }}
              animate={{
                x: [0, 0, 0, -l.from!.dx, -l.from!.dx],
                y: [0, 0, 0, -l.from!.dy, -l.from!.dy],
                opacity: [0, 1, 1, 1, 0],
                scale: [1, 1, 1, 1, 0.92],
              }}
              transition={{
                x: { duration: total / 1000, times: seg, ease: ["linear", "linear", "easeOut", "linear"] },
                y: { duration: total / 1000, times: seg, ease: ["linear", "linear", "easeOut", "linear"] },
                opacity: { duration: total / 1000, times: seg, ease: "linear" },
                scale: { duration: total / 1000, times: seg, ease: "linear" },
              }}
            >
              <span>{preset.icon}</span>
              <span className="ghost-name">{preset.name}</span>
            </motion.div>
          );
        })}

      <AnimatePresence>
        {drag?.active && ghostPreset && (
          <motion.div
            key="ghost"
            className={`drag-ghost ${deleteHot ? "compact" : ""}`}
            style={{ left: drag.x, top: drag.y }}
            transformTemplate={(_, generated) => `translate(-50%, -50%) ${generated}`}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{
              opacity: deletePhase === "idle" ? 1 : 0,
              scale: deletePhase === "ghost" ? 0.5 : deleteHot ? 0.85 : 1,
            }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{
              opacity: { duration: 0.26 },
              scale: { type: "spring", stiffness: 420, damping: 28 },
            }}
          >
            <span>{ghostPreset.icon}</span>
            <span className="ghost-name">{ghostPreset.name}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {selectedIds.size > 0 ? (
        <button
          className={`delete-zone delete-btn ${deletingSelected ? "fading" : ""}`}
          onClick={() => {
            setDeletingSelected(true);
            setRemovingSelected(new Set(selectedIds));
            setTimeout(() => {
              onRemoveMany(Array.from(selectedIds));
              setSelectedIds(new Set());
              setRemovingSelected(null);
              setDeletingSelected(false);
            }, 260);
          }}
        >
          <Trash2 size={20} />
          删除选中（{selectedIds.size}）
        </button>
      ) : drag?.active && drag.kind === "module" ? (
        <div
          className={`delete-zone ${deleteHot ? "hot" : ""} ${deletePhase === "zone" ? "fading" : ""}`}
        >
          <Trash2 size={20} />
          拖动到此区域删除
        </div>
      ) : null}
    </div>
  );
}
