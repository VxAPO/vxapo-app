import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { arrayMove } from "@dnd-kit/sortable";
import logoUrl from "./assets/VxAPO_icon_v4.svg";
import "./App.css";
import "./new.css";
import type { Block, EffectItem, PeqBandKind, PresetLibraryEntry, SideSection, ViewMode } from "./lib/model";
import { LIBRARY } from "./data/library";
import { accentStyle, buildSemanticUnits, presetAccent } from "./lib/blocks";
import { channelLabel, channelNamesFor } from "./lib/channels";
import { exportConfig, friendlyError, writeConfig } from "./lib/api";
import { parseConfigWithTail } from "./lib/toml";
import { snapPx } from "./lib/snap";
import { loadCustomPresets, loadPresetMeta, saveStored } from "./lib/storage";
import { useConfig } from "./hooks/useConfig";
import { useDevices } from "./hooks/useDevices";
import { useDragSort } from "./hooks/useDragSort";
import { useTheme } from "./hooks/useTheme";
import { useToast } from "./hooks/useToast";
import { useWindowControls } from "./hooks/useWindowControls";
import { bandDb } from "./components/CurvePlot";
import AdvancedView from "./components/AdvancedView";
import BandParamCard from "./components/BandParamCard";
import ConfirmDialog from "./components/ConfirmDialog";
import CurvePanel from "./components/CurvePanel";
import DevicePropsCard from "./components/DevicePropsCard";
import DeviceTabs from "./components/DeviceTabs";
import DragLayer from "./components/DragLayer";
import EffectCard from "./components/EffectCard";
import EffectSemanticCard from "./components/EffectSemanticCard";
import ImportDialog from "./components/ImportDialog";
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
/** 视图切换后内容高度收窄动画时长（ms） */
const VIEW_COLLAPSE_MS = 800;

/** 峰值评估频率点：全局对数扫描 + 频段中心 + 高 Q 邻域细化 + 相邻中心中点 */
function buildEvalFreqs(blocks: Block[]): number[] {
  const enabledBands = blocks.filter((b) => b.enabled).flatMap((b) => b.bands);
  const freqs = new Set<number>();
  for (let i = 0; i <= 480; i++) freqs.add(20 * Math.pow(1000, i / 480));
  if (!enabledBands.length) return [...freqs];
  const centers = enabledBands
    .map((band) => ({
      fc: Math.min(20000, Math.max(20, band.fc)),
      q: Math.min(20, Math.max(0.1, band.q)),
    }))
    .sort((a, b) => a.fc - b.fc);
  for (const { fc, q } of centers) {
    freqs.add(fc);
    if (q > 3) {
      // 半功率半宽 ≈ fc 附近 log10(1 + 1/(2q)) decades，细化覆盖 ±2 倍半宽
      const half = Math.log10(1 + 1 / (2 * q));
      const lo = Math.max(20, fc * Math.pow(10, -2 * half));
      const hi = Math.min(20000, fc * Math.pow(10, 2 * half));
      for (let i = 1; i < 24; i++) freqs.add(lo * Math.pow(hi / lo, i / 24));
    }
  }
  for (let i = 1; i < centers.length; i++) {
    freqs.add(Math.sqrt(centers[i - 1].fc * centers[i].fc));
  }
  return [...freqs];
}

/** 所有启用频段在给定统一平移量下，整条曲线（含各段 Q 响应）的真实峰值（dB） */
function curveMax(freqs: number[], blocks: Block[], fs: number, preampGainDb = 0): number {
  let m = -Infinity;
  for (const f of freqs) {
    let db = preampGainDb;
    for (const b of blocks) {
      if (!b.enabled) continue;
      for (const band of b.bands) db += bandDb(f, band, fs);
    }
    if (db > m) m = db;
  }
  return m;
}

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
  const firstChannel = channelNames[0] ?? "L";

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
  const [importOpen, setImportOpen] = useState(false);
  const [importDeviceGuid, setImportDeviceGuid] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [copyOpen, setCopyOpen] = useState(false);
  const [hintShift, setHintShift] = useState(0);
  const [marquee, setMarquee] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
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
  const oldViewHRef = useRef(0);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const marqueeStartRef = useRef<{ x: number; y: number } | null>(null);
  const marqueeRafRef = useRef(0);
  const pendingMarqueeRef = useRef<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const [selGeom, setSelGeom] = useState<{ cx: number; minY: number; maxY: number; bodyW: number; bodyH: number } | null>(null);
  const [savePresetOpen, setSavePresetOpen] = useState(false);
  const [savePresetBlocks, setSavePresetBlocks] = useState<Block[]>([]);
  const [savePresetDefaultName, setSavePresetDefaultName] = useState("自定义预设");
  const [deletePresetTarget, setDeletePresetTarget] = useState<PresetLibraryEntry | null>(null);
  const [presetMeta, setPresetMeta] = useState(loadPresetMeta);
  const toolbarElRef = useRef<HTMLDivElement | null>(null);
  const [toolbarH, setToolbarH] = useState(64);
  const [toolbarW, setToolbarW] = useState(280);
  const [selGeomTick, setSelGeomTick] = useState(0);
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

  // 峰值增益跟随当前可见调音链：通道模式只算当前选中声道，非通道模式算整条链
  const visibleBlocks = useMemo(
    () =>
      channelOn
        ? blocks.filter((b) => (b.channel ?? firstChannel) === effActiveChannel)
        : blocks,
    [blocks, channelOn, firstChannel, effActiveChannel],
  );
  const preampGainDb = useMemo(() => {
    const target = channelOn ? effActiveChannel : "all";
    const p = effects.find(
      (e) =>
        e.type === "preamp" &&
        e.enabled &&
        (e.channels?.length ? e.channels.includes(target) : target === "all"),
    );
    return typeof p?.params?.gain_db === "number" ? p.params.gain_db : 0;
  }, [effects, channelOn, effActiveChannel]);
  const visibleEffects = useMemo(() => {
    if (!channelOn) return effects;
    return effects.filter(
      (e) =>
        e.type !== "preamp" ||
        !e.channels?.length ||
        e.channels.includes(effActiveChannel),
    );
  }, [effects, channelOn, effActiveChannel]);
  const evalFreqs = useMemo(() => buildEvalFreqs(visibleBlocks), [visibleBlocks]);
  const fs = selected?.sample_rate ?? 48000;
  const peakGain = useMemo(
    () => curveMax(evalFreqs, visibleBlocks, fs, preampGainDb),
    [evalFreqs, visibleBlocks, fs, preampGainDb],
  );

  const yTop = Math.max(6, Math.min(30, Math.ceil((peakGain + 1) / 2) * 2));

  // 框选过期清理：blocks 变化后移除已不存在的 id
  useEffect(() => {
    setSelectedIds((prev) => prev.filter((id) => blocks.some((b) => b.id === id)));
  }, [blocks]);

  // 通道选择变化后，旧声道的选中卡片从当前视图消失，框选浮窗失去几何参照；
  // 直接清空选择，避免浮窗悬空/跳到错误位置。
  useEffect(() => {
    setSelectedIds([]);
    setCopyOpen(false);
  }, [channelOn, effActiveChannel]);

  const onBodyPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if (viewAnimating) return; // 视图切换动画期间不启动框选，避免命中到移动中的卡片
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
  useEffect(() => () => {
    window.clearTimeout(viewAnimTimerRef.current);
    window.clearTimeout(viewCollapseTimerRef.current);
  }, []);

  // 空态提示行水平对齐顶栏视图切换的真实中心（左右按钮簇宽度不同，不能按窗口中心算）
  useLayoutEffect(() => {
    const scrollEl = bodyRef.current;
    const segEl = document.querySelector<HTMLElement>(".view-seg");
    if (!scrollEl || !segEl) return;
    const update = () => {
      const sRect = scrollEl.getBoundingClientRect();
      const v = segEl.getBoundingClientRect();
      // 提示行实际居中在滚动内容区（clientWidth 已排除滚动条），不能拿 border-box 中心算
      const sCenter = sRect.left + scrollEl.clientLeft + scrollEl.clientWidth / 2;
      setHintShift(snapPx(v.left + v.width / 2 - sCenter));
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
  }, [selectedIds.length > 0]);

  // 动画结束、新视图稳定后，在 paint 前恢复原滚动位置。
  useLayoutEffect(() => {
    if (viewAnimating) return;
    const body = bodyRef.current;
    if (body && viewScrollTopRef.current > 0) {
      body.scrollTop = viewScrollTopRef.current;
    }
  }, [viewAnimating]);

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
  }, [selectedIds.length > 0]);

  // selGeom 延迟重测用：避免把 view 加入 effect 依赖后在动画中途就测量。
  const viewRef = useRef(view);
  useEffect(() => {
    viewRef.current = view;
  }, [view]);

  // 选中工具栏几何：按选中卡片包围盒宽度取水平中心，下边距按网格行高动态计算
  useEffect(() => {
    const body = bodyRef.current;
    if (!body || selectedIds.length === 0) {
      setSelGeom(null);
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
      const e = effects.find((x) => `e-${x.id ?? x.type}` === key);
      return `effect-card${e ? (e.enabled ? " enabled" : " disabled") : ""}`;
    },
    [effects],
  );

  const finishViewAnim = useCallback((token: number) => {
    if (token !== viewTransitionTokenRef.current) return;
    window.clearTimeout(viewAnimTimerRef.current);
    window.clearTimeout(viewCollapseTimerRef.current);
    viewTransitionPendingRef.current = false;
    // 平移结束后动画收窄：minHeight 从旧高过渡到 0（内容自然高度）。
    setViewTransitionH(0);
    setViewCollapsing(true);
    setViewAnimating(false);
    // 平移动画结束后立即重测几何并让浮窗出场；高度收窄仍在后台继续。
    // 收窄期间若发生滚动，scroll 监听会继续重测，浮窗不会跟丢。
    setSelGeomTick((v) => v + 1);
    window.setTimeout(() => {
      if (token !== viewTransitionTokenRef.current) return;
      setToolbarHidden(false);
    }, 0);
    viewCollapseTimerRef.current = window.setTimeout(() => {
      if (token !== viewTransitionTokenRef.current) return;
      setViewCollapsing(false);
    }, VIEW_COLLAPSE_MS);
  }, []);

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
    if (toolbarAnimRef.current) cancelAnimationFrame(toolbarAnimRef.current.raf);
    toolbarAnimRef.current = null;
    const body = bodyRef.current;
    if (body) {
      viewScrollTopRef.current = body.scrollTop;
      // 平移期间让内容高度保持为旧页面高度；新视图挂载后由 minHeight 取
      // max(旧高, 新高)，平移完成后再动画收窄。
      oldViewHRef.current = body.scrollHeight;
      setViewCollapsing(false);
      setViewTransitionH(body.scrollHeight);
    }
    setViewAnimating(true);
    setToolbarHidden(true);
    // 兜底：正常情况下由进场 onAnimationComplete + 退场 onExitComplete
    // 共同触发 finishViewAnim；若极端卡顿导致回调未触发，1200ms 后强制收尾。
    viewAnimTimerRef.current = window.setTimeout(() => finishViewAnim(token), 1200);
  }, [finishViewAnim]);

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

  const switchView = useCallback((v: ViewMode) => {
    if (v === view) return; // 重复点击当前视图不触发进场/退场动画
    beginViewAnim();
    blocksDragApi.cancelDrag();
    effectsDragApi.cancelDrag();
    setSegDir(v === "advanced" ? "right" : "left");
    setView(v);
  }, [view, beginViewAnim, blocksDragApi.cancelDrag, effectsDragApi.cancelDrag]);

  const toggleChannel = useCallback(() => {
    markDirty();
    // 只有通道切换会伴随视图切到 advanced 时才需要 view-stage 动画；
    // 已处于 advanced 时直接清空选择即可，不触发视图退场/进场。
    if (view !== "advanced") beginViewAnim(); else setCopyOpen(false);
    setCopyOpen(false);
    const first = channelNames[0] ?? "L";
    if (!channelOn) {
      // 开启通道选择器：全局基准电平拆成每声道一个
      setEffects((prev) => {
        const globalPreamp = prev.find((e) => e.type === "preamp" && !e.channels?.length);
        if (!globalPreamp) return prev;
        const gain =
          typeof globalPreamp.params?.gain_db === "number"
            ? globalPreamp.params.gain_db
            : 0;
        const perChannel = channelNames.map((ch) => ({
          id: `preamp:${ch}`,
          type: "preamp" as const,
          enabled: globalPreamp.enabled,
          params: { gain_db: gain },
          channels: [ch],
        }));
        return [...prev.filter((e) => e.type !== "preamp"), ...perChannel];
      });
    } else {
      // 关闭通道选择器：按第一声道合并，取消声道标识
      setEffects((prev) => {
        const firstPreamp = prev.find(
          (e) => e.type === "preamp" && e.channels?.includes(first),
        );
        if (!firstPreamp) return prev;
        const gain =
          typeof firstPreamp.params?.gain_db === "number"
            ? firstPreamp.params.gain_db
            : 0;
        return [
          ...prev.filter((e) => e.type !== "preamp"),
          {
            id: "preamp:all",
            type: "preamp" as const,
            enabled: firstPreamp.enabled,
            params: { gain_db: gain },
          },
        ];
      });
    }
    setChannelOn((v) => !v);
    setView("advanced");
    setSegDir("right");
    blocksDragApi.cancelDrag();
    effectsDragApi.cancelDrag();
  }, [channelOn, channelNames, view, markDirty, blocksDragApi.cancelDrag, effectsDragApi.cancelDrag]);

  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const openInstall = useCallback(() => setInstallOpen(true), []);
  const openImport = useCallback(() => {
    const guid = selectedGuid ?? installedDevices[0]?.guid ?? null;
    setImportDeviceGuid(guid);
    setImportOpen(true);
  }, [selectedGuid, installedDevices]);
  const handleImport = useCallback(
    async (guid: string, content: string) => {
      try {
        const parsed = parseConfigWithTail(content);
        if (parsed.tail.trim()) {
          notify("导入失败：TOML 中包含无法识别的内容");
          return;
        }
        await writeConfig(guid, content);
        setSelectedGuid(guid);
        setImportOpen(false);
        notify("导入成功");
      } catch (e) {
        notify(`导入失败：${friendlyError(e)}`);
      }
    },
    [notify, setSelectedGuid],
  );
  const handleExport = useCallback(() => {
    if (!selectedGuid) return;
    exportConfig(selectedGuid).catch((e: unknown) => notify(`导出失败：${friendlyError(e)}`));
  }, [selectedGuid, notify]);
  const handleToggleMaximize = useCallback(() => void toggleMaximize(), [toggleMaximize]);
  const handleInstalled = useCallback((name: string) => notify(`已安装 ${name}`), [notify]);
  const handleCurveChannelChange = useCallback(
    (v: string) => {
      if (channelOn) setActiveChannel(v);
    },
    [channelOn],
  );

  const handleChannelChange = useCallback((ch: string) => {
    setActiveChannel(ch);
    setSelectedIds([]);
    setCopyOpen(false);
  }, []);
  const handleAddBand = useCallback(
    (kind: PeqBandKind) => addBand(kind, effActiveChannel),
    [addBand, effActiveChannel],
  );
  const handleToggleCopy = useCallback(() => setCopyOpen((o) => !o), []);
  const normalizeGain = useCallback(() => {
    const first = channelNames[0] ?? "L";
    const groups = new Map<string, Block[]>();
    if (channelOn) {
      for (const ch of channelNames) groups.set(ch, []);
      for (const b of blocks) {
        const ch = b.channel ?? first;
        const list = groups.get(ch);
        if (list) list.push(b);
        else groups.set(ch, [b]);
      }
    } else {
      groups.set("all", blocks);
    }

    const updates: { id: string; channels?: string[]; gain_db: number }[] = [];
    for (const [ch, chBlocks] of groups) {
      const freqs = buildEvalFreqs(chBlocks);
      const peak = curveMax(freqs, chBlocks, fs, 0);
      if (Math.abs(peak) < 0.05) continue;
      updates.push(
        channelOn
          ? { id: `preamp:${ch}`, channels: [ch], gain_db: Math.round(-peak * 10) / 10 }
          : { id: "preamp:all", gain_db: Math.round(-peak * 10) / 10 },
      );
    }
    if (!updates.length) {
      notify("当前峰值增益已接近 0 dB，无需归一化");
      return;
    }
    markDirty();
    setEffects((prev) => {
      let next = prev;
      for (const u of updates) {
        const item: EffectItem = {
          id: u.id,
          type: "preamp",
          enabled: true,
          params: { gain_db: u.gain_db },
          ...(u.channels ? { channels: u.channels } : {}),
        };
        const idx = next.findIndex((e) => e.id === u.id);
        next = idx < 0 ? [...next, item] : next.map((e, i) => (i === idx ? item : e));
      }
      return next;
    });
    if (channelOn) {
      const summary = updates
        .map((u) => `${u.channels?.[0]} ${u.gain_db > 0 ? "+" : ""}${u.gain_db.toFixed(1)} dB`)
        .join("，");
      notify(`已按声道设置基准电平：${summary}`);
    } else {
      const u = updates[0];
      notify(
        `已将基准电平设为 ${u.gain_db > 0 ? "+" : ""}${u.gain_db.toFixed(1)} dB，峰值补偿到 0 dB`,
      );
    }
  }, [blocks, channelOn, channelNames, fs, markDirty, notify]);
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
        onImport={openImport}
        onExport={handleExport}
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
          activeChannel={effActiveChannel}
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
            <div
              className="view-stack"
              style={{
                minHeight: viewTransitionH ?? undefined,
                transition: viewCollapsing ? `min-height ${VIEW_COLLAPSE_MS}ms cubic-bezier(0.4, 0, 0.2, 1)` : "none",
              }}
            >
            <AnimatePresence mode="popLayout" initial={false} onExitComplete={handleViewExitComplete}>
              {!loadErr && view === "preset" && (
                <motion.div
                  key="preset"
                  data-view="preset"
                  className="view-stage"
                  onAnimationComplete={handlePresetStageComplete}
                  initial={{ x: "-100%" }}
                  animate={{ x: 0 }}
                  exit={{ x: "-100%" }}
                  transition={{ duration: 0.32, ease: "easeInOut" }}
                >
                  <PresetView
                    blocks={blocks}
                    showFilterEmptyHint={blocks.length === 0}
                    showEffectEmptyHint={visibleEffects.length === 0}
                    hintShift={hintShift}
                    selectedIds={selectedIds}
                    accentOf={accentOf}
                    effects={visibleEffects}
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
                </motion.div>
              )}

              {!loadErr && view === "advanced" && (
                <motion.div
                  key="advanced"
                  data-view="advanced"
                  className="view-stage"
                  onAnimationComplete={handleAdvancedStageComplete}
                  initial={{ x: "100%" }}
                  animate={{ x: 0 }}
                  exit={{ x: "100%" }}
                  transition={{ duration: 0.32, ease: "easeInOut" }}
                >
                  <AdvancedView
                    blocks={blocks}
                    showFilterEmptyHint={blocks.length === 0}
                    showEffectEmptyHint={visibleEffects.length === 0}
                    hintShift={hintShift}
                    channelOn={channelOn}
                    channelNames={channelNames}
                    firstChannel={channelNames[0] ?? "L"}
                    activeChannel={effActiveChannel}
                    onChannelChange={handleChannelChange}
                    selectedIds={selectedIds}
                    effects={visibleEffects}
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
                </motion.div>
              )}
            </AnimatePresence>
            </div>

            <AnimatePresence>
              {selGeom && selectedIds.length > 0 && !toolbarHidden && (
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
            </AnimatePresence>
            {marquee && (
              <div
                className="marquee-box"
                style={{
                  left: snapPx(Math.min(marquee.x1, marquee.x2)),
                  top: snapPx(Math.min(marquee.y1, marquee.y2)),
                  width: snapPx(Math.abs(marquee.x2 - marquee.x1)),
                  height: snapPx(Math.abs(marquee.y2 - marquee.y1)),
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
                onNormalize={normalizeGain}
              />
              <CurvePanel
                blocks={blocks}
                fs={selected?.sample_rate ?? 48000}
                yTop={yTop}
                preampGainDb={preampGainDb}
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
      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        devices={installedDevices}
        selectedGuid={importDeviceGuid}
        onSelectDevice={setImportDeviceGuid}
        onImport={handleImport}
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
      <AnimatePresence>{notice && <Toast message={notice} />}</AnimatePresence>
    </div>
  );
}
