import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Save, Trash2 } from "lucide-react";
import "./App.css";
import "./new.css";
import type { Block, PresetLibraryEntry, SideSection, ViewMode } from "./lib/model";
import { LIBRARY } from "./data/library";
import { presetAccent } from "./lib/blocks";
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
import InstallDialog from "./components/InstallDialog";
import PresetView from "./components/PresetView";
import SavePresetDialog from "./components/SavePresetDialog";
import SemanticUnitCard from "./components/SemanticUnitCard";
import SettingsDialog from "./components/SettingsDialog";
import Sidebar from "./components/Sidebar";
import Toast from "./components/Toast";
import TopBar from "./components/TopBar";
import UninstallDialog from "./components/UninstallDialog";

export default function App() {
  const { notice, notify } = useToast();
  const [loadErr, setLoadErr] = useState("");
  const onError = useCallback((msg: string) => setLoadErr(msg), []);

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
  } = useDevices(onError, (name) => notify(`已卸载 ${name}`));

  const {
    blocks,
    setBlocks,
    effects,
    markDirty,
    applyPreset,
    addBand,
    addEffect,
    removeEffect,
    toggleEffect,
    patchEffectParam,
    removeBlock,
    removeGroup,
    patchBlock,
    patchBand,
    totalBands,
    deviceTuningOn,
    toggleDeviceTuning,
  } = useConfig(selectedGuid, onError, notify);

  const { theme, setTheme } = useTheme();
  const { isMax, minimize, toggleMaximize, close } = useWindowControls();

  const [view, setView] = useState<ViewMode>("preset");
  const [side, setSide] = useState<SideSection>("preset");
  const [segDir, setSegDir] = useState<"left" | "right">("right");
  const [channelOn, setChannelOn] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [installOpen, setInstallOpen] = useState(false);
  const [curveChannel, setCurveChannel] = useState("左声道");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [marquee, setMarquee] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const bottomRowRef = useRef<HTMLDivElement | null>(null);
  const [bottomBarPad, setBottomBarPad] = useState(220);
  const marqueeStartRef = useRef<{ x: number; y: number } | null>(null);
  const [selGeom, setSelGeom] = useState<{ cx: number; top: number; bodyW: number; bodyH: number } | null>(null);
  const [savePresetOpen, setSavePresetOpen] = useState(false);
  const [savePresetBlocks, setSavePresetBlocks] = useState<Block[]>([]);
  const [savePresetDefaultName, setSavePresetDefaultName] = useState("自定义预设");
  const [deletePresetTarget, setDeletePresetTarget] = useState<PresetLibraryEntry | null>(null);
  const [presetMeta, setPresetMeta] = useState<Record<string, { presetId: string; accent: string }>>(() => {
    try {
      return JSON.parse(localStorage.getItem("vxapo.presetMeta") ?? "{}");
    } catch {
      return {};
    }
  });
  const toolbarElRef = useRef<HTMLDivElement | null>(null);
  const toolbarAnimRef = useRef<{
    raf: number;
    start: { x: number; y: number };
    ctrl: { x: number; y: number };
    to: { x: number; y: number };
    t0: number;
  } | null>(null);
  const [customPresets, setCustomPresets] = useState<PresetLibraryEntry[]>(() => {
    try {
      return JSON.parse(localStorage.getItem("vxapo.customPresets") ?? "[]") as PresetLibraryEntry[];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem("vxapo.customPresets", JSON.stringify(customPresets));
  }, [customPresets]);

  useEffect(() => {
    localStorage.setItem("vxapo.presetMeta", JSON.stringify(presetMeta));
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
    const t = e.target as HTMLElement;
    if (t.closest("[data-dnd-id], button, input, select, .bottom-row")) return;
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
    setMarquee({ x1: s.x, y1: s.y, x2: x, y2: y });
  };

  const onBodyPointerUp = () => {
    const s = marqueeStartRef.current;
    const body = bodyRef.current;
    const m = marquee;
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

  const deleteSelectedCards = () => {
    const ids = selectedIds;
    if (!ids.length) return;
    markDirty();
    setBlocks((prev) => prev.filter((b) => !ids.includes(b.id ?? "")));
    setSelectedIds([]);
  };

  const openSavePreset = () => {
    const picked = blocks.filter((b) => selectedIds.includes(b.id ?? ""));
    if (!picked.length) return;
    setSavePresetBlocks(picked);
    setSavePresetDefaultName(`自定义预设 ${customPresets.length + 1}`);
    setSavePresetOpen(true);
  };

  // 已使用：当前 blocks 里还存在该预设注册过组标签的卡片
  const usedPresetIds = useMemo(() => {
    const used = new Set<string>();
    for (const [label, meta] of Object.entries(presetMeta)) {
      if (blocks.some((b) => b.group === label)) used.add(meta.presetId);
    }
    return used;
  }, [blocks, presetMeta]);

  // 卡片配色：预设注册的组色优先，否则按频段感知推导
  const accentOf = (b: Block): string =>
    (b.group ? presetMeta[b.group]?.accent : undefined) ?? presetAccent(b.bands);

  const handleApplyPreset = (p: PresetLibraryEntry) => {
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
  };

  const handleSavePreset = (name: string, desc: string, color: string, descriptions: string[]) => {
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
  };

  const confirmDeletePreset = () => {
    if (!deletePresetTarget) return;
    setCustomPresets((prev) => prev.filter((p) => p.id !== deletePresetTarget.id));
    setDeletePresetTarget(null);
    notify("已删除自定义预设");
  };

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
  }, [selectedIds, blocks]);

  // 工具栏目标位置（选中范围变化后用于飞行）
  const toolbarTarget = useMemo(
    () =>
      selGeom
        ? {
            x: Math.max(8, Math.min(selGeom.cx, selGeom.bodyW - 8)),
            y: Math.max(8, Math.min(selGeom.top, selGeom.bodyH - 64)),
          }
        : null,
    [selGeom],
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

  // 底部悬浮条真实高度 -> 调音区底部留白，保证最后一行卡片能完全滚到悬浮条上方
  useLayoutEffect(() => {
    const el = bottomRowRef.current;
    if (!el) return;
    const update = () => setBottomBarPad(Math.ceil(el.getBoundingClientRect().height) + 16);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
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

  const dragApi = useDragSort({ setBlocks, markDirty, overlayContent });

  const overlayClassForKey = (key: string): string => {
    const b = blocks.find((x) => x.id === key);
    if (!b) return "group-card";
    return view === "preset"
      ? "group-card standalone"
      : `band-card${b.enabled ? " enabled" : " disabled"}`;
  };

  // 拖拽悬浮/飞行副本携带组配色，组名+叉的 chip 使用真实组色
  const overlayStyleForKey = (key: string): CSSProperties | undefined => {
    if (view !== "preset") return undefined;
    const b = blocks.find((x) => x.id === key);
    return b ? ({ "--card-accent": accentOf(b) } as CSSProperties) : undefined;
  };

  const switchView = (v: ViewMode) => {
    dragApi.cancelDrag();
    setSegDir(v === "advanced" ? "right" : "left");
    setView(v);
  };

  const toggleChannel = () => {
    markDirty();
    setChannelOn((v) => !v);
  };

  return (
    <div className="app-shell-new">
      <TopBar
        view={view}
        channelOn={channelOn}
        segDir={segDir}
        isMax={isMax}
        onViewChange={switchView}
        onOpenSettings={() => setSettingsOpen(true)}
        onMinimize={minimize}
        onToggleMaximize={() => void toggleMaximize()}
        onClose={close}
      />

      <div className="main">
        <Sidebar
          side={side}
          onSideChange={setSide}
          library={LIBRARY}
          customPresets={customPresets}
          usedPresets={[...usedPresetIds]}
          effects={effects}
          onApplyPreset={handleApplyPreset}
          onDeletePreset={setDeletePresetTarget}
          onAddEffect={addEffect}
          onAddBand={addBand}
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
            onAdd={() => setInstallOpen(true)}
          />

          <div className="device-body">
            <div
              className="tuning-scroll"
              ref={bodyRef}
              style={{ paddingBottom: bottomBarPad }}
              onPointerDown={onBodyPointerDown}
              onPointerMove={onBodyPointerMove}
              onPointerUp={onBodyPointerUp}
              onPointerCancel={onBodyPointerUp}
            >
              {loadErr && <div className="hint-row show err">{loadErr}</div>}
            {!loadErr && view === "preset" && (
              <PresetView
                blocks={blocks}
                blocksEmpty={blocks.length === 0}
                selectedIds={selectedIds}
                accentOf={accentOf}
                effects={effects}
                onToggleEffect={toggleEffect}
                onRemoveEffect={removeEffect}
                onChangeEffectParam={patchEffectParam}
                activeKey={dragApi.activeKey}
                flyKey={dragApi.fly?.key ?? null}
                virtualIndexOf={dragApi.virtualIndexOf}
                onDragStart={dragApi.startDrag}
                onRemoveBlock={removeBlock}
                onRemoveGroup={removeGroup}
                onPatchBand={patchBand}
              />
            )}

            {!loadErr && view === "advanced" && (
              <AdvancedView
                blocks={blocks}
                channelOn={channelOn}
                selectedIds={selectedIds}
                effects={effects}
                onToggleEffect={toggleEffect}
                onRemoveEffect={removeEffect}
                onChangeEffectParam={patchEffectParam}
                activeKey={dragApi.activeKey}
                flyKey={dragApi.fly?.key ?? null}
                virtualIndexOf={dragApi.virtualIndexOf}
                onDragStart={dragApi.startDrag}
                onRemoveBlock={removeBlock}
                onPatchBlock={patchBlock}
                onPatchBand={patchBand}
              />
            )}

            {selGeom && selectedIds.length > 0 && (
              <div
                className="sel-toolbar"
                ref={toolbarElRef}
              >
                <div className="sel-toolbar-label">已选 {selectedIds.length} 段</div>
                <div className="sel-toolbar-actions">
                  <button className="sel-action save" type="button" onClick={openSavePreset}>
                    <Save size={14} strokeWidth={2.2} />
                    <span>保存为自定义预设</span>
                  </button>
                  <button className="sel-action delete" type="button" onClick={deleteSelectedCards}>
                    <Trash2 size={14} strokeWidth={2.2} />
                    <span>删除</span>
                  </button>
                </div>
              </div>
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
            <div className="bottom-row" ref={bottomRowRef}>
              <DevicePropsCard device={selected} peakGain={peakGain} totalBands={totalBands} />
              <CurvePanel
                blocks={blocks}
                fs={selected?.sample_rate ?? 48000}
                yTop={yTop}
                curveChannel={curveChannel}
                onCurveChannelChange={setCurveChannel}
              />
            </div>
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
        onOpenChange={(open) => {
          if (!open) setDeletePresetTarget(null);
        }}
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
        onInstalled={(name) => notify(`已安装 ${name}`)}
      />
      <UninstallDialog
        device={uninstallTarget}
        open={uninstallTarget !== null}
        busy={uninstalling}
        onOpenChange={(open) => {
          if (!open) setUninstallTarget(null);
        }}
        onConfirm={() => void confirmUninstall()}
      />
      <DragLayer
        activeKey={dragApi.activeKey}
        dragSize={dragApi.dragSize}
        fly={dragApi.fly}
        overlayRef={dragApi.overlayRef}
        activeContent={dragApi.activeKey ? dragApi.renderOverlay(dragApi.activeKey, dragApi.overlayNum) : null}
        classForKey={overlayClassForKey}
        styleForKey={overlayStyleForKey}
      />
      {notice && <Toast message={notice} />}
    </div>
  );
}
