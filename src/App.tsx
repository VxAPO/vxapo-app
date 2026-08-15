import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { arrayMove } from "@dnd-kit/sortable";
import logoUrl from "./assets/VxAPO_icon_v4.svg";
import "./App.css";
import "./new.css";
import type { Block, PresetLibraryEntry, SideSection, ViewMode } from "./lib/model";
import { LIBRARY } from "./data/library";
import { accentStyle, buildSemanticUnits, presetAccent } from "./lib/blocks";
import { channelLabel, channelNamesFor } from "./lib/channels";
import { loadCustomPresets, loadPresetMeta, saveStored } from "./lib/storage";
import { useConfig } from "./hooks/useConfig";
import { useDevices } from "./hooks/useDevices";
import { useDragSort } from "./hooks/useDragSort";
import { useTheme } from "./hooks/useTheme";
import { useToast } from "./hooks/useToast";
import { useWindowControls } from "./hooks/useWindowControls";
import { peakingDb } from "./components/CurvePlot";
import AdvancedView from "./components/AdvancedView";
import BandParamCard from "./components/BandParamCard";
import ConfirmDialog from "./components/ConfirmDialog";
import CurvePanel from "./components/CurvePanel";
import DevicePropsCard from "./components/DevicePropsCard";
import DeviceTabs from "./components/DeviceTabs";
import DragLayer from "./components/DragLayer";
import EffectCard from "./components/EffectCard";
import EffectSemanticCard from "./components/EffectSemanticCard";
import InstallDialog from "./components/InstallDialog";
import PresetView from "./components/PresetView";
import SavePresetDialog from "./components/SavePresetDialog";
import SelectionToolbar from "./components/SelectionToolbar";
import SemanticUnitCard from "./components/SemanticUnitCard";
import SettingsDialog from "./components/SettingsDialog";
import Sidebar from "./components/Sidebar";
import Toast from "./components/Toast";
import TopBar from "./components/TopBar";
import UninstallDialog from "./components/UninstallDialog";

/** 底部悬浮条预留高度：保证最后一行卡片能完全滚到悬浮条上方 */
const BOTTOM_BAR_PAD = 400;

export default function App() {
  const { notice, notify } = useToast();
  const [loadErr, setLoadErr] = useState("");
  const onError = useCallback((msg: string) => setLoadErr(msg), []);
  const handleUninstalled = useCallback((name: string) => notify(`已卸载 ${name}`), [notify]);

  const {
    selectedGuid,
    setSelectedGuid,
    selected,
    devices,
    refresh,
    installedDevices,
    uninstallTarget,
    setUninstallTarget,
    uninstalling,
    confirmUninstall,
  } = useDevices(onError, handleUninstalled);

  const [channelOn, setChannelOn] = useState(false);
  const [activeChannel, setActiveChannel] = useState("L");
  const channelNames = useMemo(
    () => channelNamesFor(selected?.channels),
    [selected?.channels],
  );
  const effActiveChannel = channelNames.includes(activeChannel) ? activeChannel : (channelNames[0] ?? "L");

  const {
    blocks,
    setBlocks,
    effects,
    setEffects,
    markDirty,
    applyPreset,
    addBand,
    addEffect,
    removeEffect,
    toggleEffect,
    patchEffectParam,
    patchEffectSemantic,
    removeBlock,
    removeGroup,
    patchBlock,
    patchBand,
    totalBands,
    channelBandCounts,
    deviceTuningOn,
    toggleDeviceTuning,
  } = useConfig(installedDevices.length === 0 ? null : selectedGuid, onError, notify, {
    mode: channelOn,
    first: channelNames[0] ?? "L",
    active: effActiveChannel,
  });

  const { theme, setTheme } = useTheme();
  const { isMax, minimize, toggleMaximize, close } = useWindowControls();

  const [view, setView] = useState<ViewMode>("preset");
  const [side, setSide] = useState<SideSection>("preset");
  const [segDir, setSegDir] = useState<"left" | "right">("right");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [installOpen, setInstallOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [copyOpen, setCopyOpen] = useState(false);
  const [hintShift, setHintShift] = useState(0);
  const [marquee, setMarquee] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const marqueeStartRef = useRef<{ x: number; y: number } | null>(null);
  const marqueeRafRef = useRef(0);
  const pendingMarqueeRef = useRef<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [selGeom, setSelGeom] = useState<{ cx: number; top: number; bodyW: number; bodyH: number } | null>(null);
  const [savePresetOpen, setSavePresetOpen] = useState(false);
  const [savePresetBlocks, setSavePresetBlocks] = useState<Block[]>([]);
  const [savePresetDefaultName, setSavePresetDefaultName] = useState("自定义预设");
  const [deletePresetTarget, setDeletePresetTarget] = useState<PresetLibraryEntry | null>(null);
  const [presetMeta, setPresetMeta] = useState(loadPresetMeta);
  const toolbarElRef = useRef<HTMLDivElement | null>(null);
  const toolbarAnimRef = useRef<{
    raf: number;
    start: { x: number; y: number };
    ctrl: { x: number; y: number };
    to: { x: number; y: number };
    t0: number;
  } | null>(null);
  const [customPresets, setCustomPresets] = useState(loadCustomPresets);

  useEffect(() => {
    saveStored("vxapo.customPresets", customPresets);
  }, [customPresets]);

  useEffect(() => {
    saveStored("vxapo.presetMeta", presetMeta);
  }, [presetMeta]);

  const peakGain = useMemo(() => {
    let m = 0;
    const fs = selected?.sample_rate ?? 48000;
    for (let i = 0; i <= 480; i++) {
      const f = 20 * Math.pow(1000, i / 480);
      let db = 0;
      for (const b of blocks) {
        if (!b.enabled) continue;
        for (const band of b.bands) db += peakingDb(f, band.fc, band.gain_db, band.q, fs);
      }
      if (db > m) m = db;
    }
    return m;
  }, [blocks, selected?.sample_rate]);

  const yTop = Math.max(6, Math.min(30, Math.ceil((peakGain + 1) / 2) * 2));

  // 框选过期清理：blocks 变化后移除已不存在的 id
  useEffect(() => {
    setSelectedIds((prev) => prev.filter((id) => blocks.some((b) => b.id === id)));
  }, [blocks]);

  const onBodyPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const t = e.target;
    if (!(t instanceof Element)) return;
    if (t.closest("[data-dnd-id], button, input, select, .bottom-row, .gs-root, [role='slider']")) return;
    const body = bodyRef.current;
    if (!body) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* 捕获失败继续走元素事件 */
    }
    const rect = body.getBoundingClientRect();
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
        pendingMarqueeRef.current = null;
        if (m) setMarquee(m);
      });
    }
  };

  const onBodyPointerUp = () => {
    window.cancelAnimationFrame(marqueeRafRef.current);
    marqueeRafRef.current = 0;
    const s = marqueeStartRef.current;
    const body = bodyRef.current;
    const m = marquee ?? pendingMarqueeRef.current;
    pendingMarqueeRef.current = null;
    marqueeStartRef.current = null;
    setMarquee(null);
    if (!s || !body || !m) return;
    const rect = body.getBoundingClientRect();
    const x1 = Math.min(m.x1, m.x2);
    const x2 = Math.max(m.x1, m.x2);
    const y1 = Math.min(m.y1, m.y2);
    const y2 = Math.max(m.y1, m.y2);
    if (x2 - x1 < 4 && y2 - y1 < 4) {
      // 点空白：清空选择
      setSelectedIds([]);
      return;
    }
    const ids: string[] = [];
    body.querySelectorAll<HTMLElement>("[data-dnd-id]").forEach((el) => {
      if (el.dataset.dndGroup === "effects") return;
      const r = el.getBoundingClientRect();
      const rx = r.left - rect.left + body.scrollLeft;
      const ry = r.top - rect.top + body.scrollTop;
      if (rx < x2 && rx + r.width > x1 && ry < y2 && ry + r.height > y1) {
        const id = el.dataset.dndId;
        if (id) ids.push(id);
      }
    });
    setSelectedIds(ids);
  };

  useEffect(() => () => window.cancelAnimationFrame(marqueeRafRef.current), []);

  // 空态提示行水平对齐顶栏视图切换的真实中心（左右按钮簇宽度不同，不能按窗口中心算）
  useLayoutEffect(() => {
    const scrollEl = bodyRef.current;
    const segEl = document.querySelector<HTMLElement>(".view-seg");
    if (!scrollEl || !segEl) return;
    const update = () => {
      const s = scrollEl.getBoundingClientRect();
      const v = segEl.getBoundingClientRect();
      setHintShift(v.left + v.width / 2 - (s.left + s.width / 2));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(scrollEl);
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  const deleteSelectedCards = useCallback(() => {
    const ids = selectedIds;
    if (!ids.length) return;
    markDirty();
    setBlocks((prev) => prev.filter((b) => !ids.includes(b.id ?? "")));
    setSelectedIds([]);
  }, [selectedIds, markDirty]);

  const copySelectedToChannel = useCallback((ch: string) => {
    const ids = selectedIds;
    if (!ids.length || !channelOn) return;
    const count = ids.length;
    if ((channelBandCounts[ch] ?? 0) + count > 31) {
      notify(`目标声道最多 31 段，复制 ${count} 段将超限`);
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
    notify(`已复制 ${count} 段到${channelLabel(ch)}`);
  }, [selectedIds, channelOn, channelBandCounts, markDirty, notify]);

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

  const openSavePreset = useCallback(() => {
    const picked = blocks.filter((b) => selectedIds.includes(b.id ?? ""));
    if (!picked.length) return;
    setSavePresetBlocks(picked);
    setSavePresetDefaultName(`自定义预设 ${customPresets.length + 1}`);
    setSavePresetOpen(true);
  }, [blocks, selectedIds, customPresets]);

  // 已使用：当前 blocks 里还存在该预设注册过组标签的卡片
  const usedPresetIds = useMemo(() => {
    const used = new Set<string>();
    for (const [label, meta] of Object.entries(presetMeta)) {
      if (blocks.some((b) => b.group === label)) used.add(meta.presetId);
    }
    return used;
  }, [blocks, presetMeta]);

  // 卡片配色：预设注册的组色优先，否则按频段感知推导
  const accentOf = useCallback(
    (b: Block): string =>
      (b.group ? presetMeta[b.group]?.accent : undefined) ?? presetAccent(b.bands),
    [presetMeta],
  );

  const handleApplyPreset = useCallback((p: PresetLibraryEntry) => {
    if (usedPresetIds.has(p.id)) {
      notify("该预设已添加过一次");
      return;
    }
    const label = applyPreset(p);
    if (label) {
      setPresetMeta((prev) => ({
        ...prev,
        [label]: { presetId: p.id, accent: p.color ?? presetAccent(p.bands) },
      }));
    }
  }, [usedPresetIds, applyPreset, notify]);

  const handleSavePreset = useCallback((name: string, desc: string, color: string, descriptions: string[]) => {
    const entry: PresetLibraryEntry = {
      id: `custom-${Date.now()}`,
      group: "自定义",
      name,
      desc,
      color,
      bands: savePresetBlocks.map((b, i) => ({
        ...(b.bands[0] ?? { fc: 1000, gain_db: 0, q: 1 }),
        name: descriptions[i] || undefined,
      })),
    };
    setCustomPresets((prev) => [...prev, entry]);
    setSavePresetOpen(false);
    setSelectedIds([]);
    notify("已保存自定义预设");
  }, [savePresetBlocks, notify]);

  const confirmDeletePreset = useCallback(() => {
    if (!deletePresetTarget) return;
    setCustomPresets((prev) => prev.filter((p) => p.id !== deletePresetTarget.id));
    setDeletePresetTarget(null);
    notify("已删除自定义预设");
  }, [deletePresetTarget, notify]);

  // 选中工具栏几何：按选中卡片包围盒宽度取水平中心，下边距按网格行高动态计算
  useEffect(() => {
    const body = bodyRef.current;
    if (!body || selectedIds.length === 0) {
      setSelGeom(null);
      return;
    }
    const rect = body.getBoundingClientRect();
    const els = selectedIds
      .map((id) => body.querySelector<HTMLElement>(`[data-dnd-id="${id}"]`))
      .filter((el): el is HTMLElement => !!el);
    if (!els.length) {
      setSelGeom(null);
      return;
    }
    let minX = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let rowH = 0;
    for (const el of els) {
      const r = el.getBoundingClientRect();
      const x = r.left - rect.left + body.scrollLeft;
      const y = r.top - rect.top + body.scrollTop;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x + r.width);
      maxY = Math.max(maxY, y + r.height);
      rowH = Math.max(rowH, r.height);
    }
    setSelGeom({
      cx: (minX + maxX) / 2,
      top: maxY + Math.round(rowH * 0.5),
      bodyW: rect.width,
      bodyH: rect.height,
    });
  }, [selectedIds, blocks, view]);

  // 工具栏目标位置（选中范围变化后用于飞行）
  const toolbarTarget = useMemo(
    () =>
      selGeom
        ? {
            x: Math.max(8, Math.min(selGeom.cx, selGeom.bodyW - 8)),
            y: Math.max(
              8,
              Math.min(selGeom.top - (view === "advanced" ? 36 : 10), selGeom.bodyH - 64),
            ),
          }
        : null,
    [selGeom, view],
  );

  // 位移动画沿用卡片飞行的二次贝塞尔：控制点水平偏移、先快后慢
  useLayoutEffect(() => {
    const el = toolbarElRef.current;
    if (!el || !toolbarTarget) return;
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
      if (!node || !anim) return;
      const t = Math.min(1, (performance.now() - anim.t0) / 400);
      const k = 1 - Math.pow(1 - t, 4);
      const inv = 1 - k;
      const x = inv * inv * anim.start.x + 2 * inv * k * anim.ctrl.x + k * k * anim.to.x;
      const y = inv * inv * anim.start.y + 2 * inv * k * anim.ctrl.y + k * k * anim.to.y;
      node.style.left = `${Math.round(x)}px`;
      node.style.top = `${Math.round(y)}px`;
      if (t < 1) {
        anim.raf = requestAnimationFrame(step);
      } else {
        toolbarAnimRef.current = null;
        node.style.left = `${anim.to.x}px`;
        node.style.top = `${anim.to.y}px`;
      }
    };
    toolbarAnimRef.current = { raf: requestAnimationFrame(step), start, ctrl, to: toolbarTarget, t0 };
  }, [toolbarTarget]);

  useEffect(
    () => () => {
      if (toolbarAnimRef.current) cancelAnimationFrame(toolbarAnimRef.current.raf);
    },
    [],
  );

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
        const oi = prev.findIndex((e) => `e-${e.type}` === key);
        if (oi < 0 || oi === target) return prev;
        return arrayMove(prev, oi, target);
      });
    },
    [setEffects],
  );

  const effectOverlayContent = useCallback(
    (key: string, _num: number): ReactNode => {
      const type = key.slice(2);
      const e = effects.find((x) => x.type === type);
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
        : `band-card${b.enabled ? " enabled" : " disabled"}`;
    },
    [blocks, view],
  );

  // 拖拽悬浮/飞行副本携带组配色，组名+叉的 chip 使用真实组色
  const overlayStyleForKey = useCallback(
    (key: string): CSSProperties | undefined => {
      if (view !== "preset") return undefined;
      const b = blocks.find((x) => x.id === key);
      return b ? accentStyle(accentOf(b)) : undefined;
    },
    [view, blocks, accentOf],
  );

  const effectOverlayClassForKey = useCallback(
    (key: string): string => {
      const e = effects.find((x) => `e-${x.type}` === key);
      return `effect-card${e ? (e.enabled ? " enabled" : " disabled") : ""}`;
    },
    [effects],
  );

  const switchView = useCallback((v: ViewMode) => {
    blocksDragApi.cancelDrag();
    effectsDragApi.cancelDrag();
    setSegDir(v === "advanced" ? "right" : "left");
    setView(v);
  }, [blocksDragApi.cancelDrag, effectsDragApi.cancelDrag]);

  const toggleChannel = useCallback(() => {
    markDirty();
    setChannelOn((v) => !v);
    setView("advanced");
    setSegDir("right");
    blocksDragApi.cancelDrag();
    effectsDragApi.cancelDrag();
  }, [markDirty, blocksDragApi.cancelDrag, effectsDragApi.cancelDrag]);

  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const openInstall = useCallback(() => setInstallOpen(true), []);
  const handleToggleMaximize = useCallback(() => void toggleMaximize(), [toggleMaximize]);
  const handleInstalled = useCallback((name: string) => notify(`已安装 ${name}`), [notify]);
  const handleCurveChannelChange = useCallback(
    (v: string) => {
      if (channelOn) setActiveChannel(v);
    },
    [channelOn],
  );
  const handleAddBand = useCallback(() => addBand(effActiveChannel), [addBand, effActiveChannel]);
  const handleToggleCopy = useCallback(() => setCopyOpen((o) => !o), []);
  const closeDeletePreset = useCallback((open: boolean) => {
    if (!open) setDeletePresetTarget(null);
  }, []);
  const closeUninstall = useCallback((open: boolean) => {
    if (!open) setUninstallTarget(null);
  }, []);
  const handleConfirmUninstall = useCallback(() => {
    void confirmUninstall();
  }, [confirmUninstall]);

  const usedPresetList = useMemo(() => [...usedPresetIds], [usedPresetIds]);
  const channelCounts = useMemo(
    () => channelNames.map((c) => channelBandCounts[c] ?? 0),
    [channelNames, channelBandCounts],
  );

  return (
    <div className="app-shell-new">
      <TopBar
        view={view}
        channelOn={channelOn}
        noDevices={installedDevices.length === 0}
        segDir={segDir}
        isMax={isMax}
        onViewChange={switchView}
        onOpenSettings={openSettings}
        onMinimize={minimize}
        onToggleMaximize={handleToggleMaximize}
        onClose={close}
      />

      <div className="main">
        <Sidebar
          disabled={installedDevices.length === 0}
          side={side}
          onSideChange={setSide}
          library={LIBRARY}
          customPresets={customPresets}
          usedPresets={usedPresetList}
          effects={effects}
          onApplyPreset={handleApplyPreset}
          onDeletePreset={setDeletePresetTarget}
          onAddEffect={addEffect}
          onAddBand={handleAddBand}
          channelOn={channelOn}
          onToggleChannel={toggleChannel}
        />

        <main className="content">
          <DeviceTabs
            devices={installedDevices}
            selectedGuid={selectedGuid}
            tuningOn={deviceTuningOn}
            onSelect={setSelectedGuid}
            onToggleTuning={toggleDeviceTuning}
            onUninstall={setUninstallTarget}
            onAdd={openInstall}
          />

          <div className="device-body">
            {installedDevices.length === 0 ? (
              <div className="no-device">
                <img className="no-device-logo" src={logoUrl} alt="" draggable={false} />
                <button
                  type="button"
                  className="no-device-row"
                  onClick={() => setInstallOpen(true)}
                >
                  <span className="no-device-plus">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="2" strokeLinecap="butt" />
                    </svg>
                  </span>
                  <span className="no-device-tip">点击加号安装 VxAPO</span>
                </button>
              </div>
            ) : (
              <>
            <div
              className="tuning-scroll"
              ref={bodyRef}
              style={{ paddingBottom: BOTTOM_BAR_PAD }}
              onPointerDown={onBodyPointerDown}
              onPointerMove={onBodyPointerMove}
              onPointerUp={onBodyPointerUp}
              onPointerCancel={onBodyPointerUp}
            >
              {loadErr && <div className="hint-row show err">{loadErr}</div>}
            {!loadErr && view === "preset" && (
              <PresetView
                blocks={blocks}
                showFilterEmptyHint={blocks.length === 0}
                showEffectEmptyHint={effects.length === 0}
                hintShift={hintShift}
                selectedIds={selectedIds}
                accentOf={accentOf}
                effects={effects}
                onToggleEffect={toggleEffect}
                onRemoveEffect={removeEffect}
                onChangeEffectStrength={patchEffectSemantic}
                activeKey={blocksDragApi.activeKey}
                flyKey={blocksDragApi.fly?.key ?? null}
                virtualIndexOf={blocksDragApi.virtualIndexOf}
                onDragStart={blocksDragApi.startDrag}
                effectActiveKey={effectsDragApi.activeKey}
                effectFlyKey={effectsDragApi.fly?.key ?? null}
                effectOnDragStart={effectsDragApi.startDrag}
                onRemoveBlock={removeBlock}
                onRemoveGroup={removeGroup}
                onPatchBlock={patchBlock}
                onPatchBand={patchBand}
              />
            )}

            {!loadErr && view === "advanced" && (
              <AdvancedView
                blocks={blocks}
                showFilterEmptyHint={blocks.length === 0}
                showEffectEmptyHint={effects.length === 0}
                hintShift={hintShift}
                channelOn={channelOn}
                channelNames={channelNames}
                firstChannel={channelNames[0] ?? "L"}
                activeChannel={effActiveChannel}
                onChannelChange={setActiveChannel}
                selectedIds={selectedIds}
                effects={effects}
                onToggleEffect={toggleEffect}
                onRemoveEffect={removeEffect}
                onChangeEffectParam={patchEffectParam}
                activeKey={blocksDragApi.activeKey}
                flyKey={blocksDragApi.fly?.key ?? null}
                virtualIndexOf={blocksDragApi.virtualIndexOf}
                onDragStart={blocksDragApi.startDrag}
                effectActiveKey={effectsDragApi.activeKey}
                effectFlyKey={effectsDragApi.fly?.key ?? null}
                effectOnDragStart={effectsDragApi.startDrag}
                onRemoveBlock={removeBlock}
                onPatchBlock={patchBlock}
                onPatchBand={patchBand}
              />
            )}

            {selGeom && selectedIds.length > 0 && (
              <SelectionToolbar
                selectedCount={selectedIds.length}
                channelOn={channelOn}
                channelNames={channelNames}
                activeChannel={effActiveChannel}
                copyOpen={copyOpen}
                toolbarRef={toolbarElRef}
                onToggleCopy={handleToggleCopy}
                onCopyToChannel={copySelectedToChannel}
                onSave={openSavePreset}
                onDelete={deleteSelectedCards}
              />
            )}
            {marquee && (
              <div
                className="marquee-box"
                style={{
                  left: Math.min(marquee.x1, marquee.x2),
                  top: Math.min(marquee.y1, marquee.y2),
                  width: Math.abs(marquee.x2 - marquee.x1),
                  height: Math.abs(marquee.y2 - marquee.y1),
                }}
              />
            )}
            </div>
            <div className="bottom-row">
              <DevicePropsCard
                device={selected}
                peakGain={peakGain}
                totalBands={totalBands}
                channelOn={channelOn}
                channelCounts={channelCounts}
              />
              <CurvePanel
                blocks={blocks}
                fs={selected?.sample_rate ?? 48000}
                yTop={yTop}
                curveChannel={channelOn ? effActiveChannel : "all"}
                onCurveChannelChange={handleCurveChannelChange}
                channelOn={channelOn}
                channelNames={channelNames}
                firstChannel={channelNames[0] ?? "L"}
              />
            </div>
              </>
            )}
          </div>
        </main>
      </div>

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        theme={theme}
        onThemeChange={setTheme}
      />
      <SavePresetDialog
        open={savePresetOpen}
        onOpenChange={setSavePresetOpen}
        blocks={savePresetBlocks}
        defaultName={savePresetDefaultName}
        onSave={handleSavePreset}
      />
      <ConfirmDialog
        open={deletePresetTarget !== null}
        onOpenChange={closeDeletePreset}
        title="删除自定义预设"
        message={
          deletePresetTarget ? `确定删除“${deletePresetTarget.name}”吗？删除后不可恢复。` : ""
        }
        onConfirm={confirmDeletePreset}
      />
      <InstallDialog
        open={installOpen}
        onOpenChange={setInstallOpen}
        devices={devices}
        onError={onError}
        onRefresh={refresh}
        onInstalled={handleInstalled}
      />
      <UninstallDialog
        device={uninstallTarget}
        open={uninstallTarget !== null}
        busy={uninstalling}
        onOpenChange={closeUninstall}
        onConfirm={handleConfirmUninstall}
      />
      <DragLayer
        activeKey={blocksDragApi.activeKey}
        dragSize={blocksDragApi.dragSize}
        fly={blocksDragApi.fly}
        overlayRef={blocksDragApi.overlayRef}
        activeContent={blocksDragApi.activeKey ? blocksDragApi.renderOverlay(blocksDragApi.activeKey, blocksDragApi.overlayNum) : null}
        classForKey={overlayClassForKey}
        styleForKey={overlayStyleForKey}
      />
      <DragLayer
        activeKey={effectsDragApi.activeKey}
        dragSize={effectsDragApi.dragSize}
        fly={effectsDragApi.fly}
        overlayRef={effectsDragApi.overlayRef}
        activeContent={effectsDragApi.activeKey ? effectsDragApi.renderOverlay(effectsDragApi.activeKey, effectsDragApi.overlayNum) : null}
        classForKey={effectOverlayClassForKey}
      />
      {notice && <Toast message={notice} />}
    </div>
  );
}
