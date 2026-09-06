import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import logoUrl from "./assets/VxAPO_icon_v4.svg";
import "./App.css";
import "./new.css";
import type { Block, Device, EffectItem, PeqBandKind } from "./lib/model";
import { LIBRARY } from "./data/library";
import { channelNamesFor } from "./lib/channels";
import { exportConfig, friendlyError, writeConfig } from "./lib/api";
import { parseConfigWithTail } from "./lib/toml";
import { snapPx } from "./lib/snap";
import { buildEvalFreqs, curveRange } from "./lib/curve";
import { planNormalize } from "./lib/normalize";
import { useConfig } from "./hooks/useConfig";
import { useDevices } from "./hooks/useDevices";
import { useTheme } from "./hooks/useTheme";
import { useToast } from "./hooks/useToast";
import { useI18n } from "./lib/i18n";
import { t } from "./lib/i18n/core";
import { useWindowControls } from "./hooks/useWindowControls";
import OverlayScrollbar from "./components/OverlayScrollbar";
import { useChannelState } from "./hooks/useChannelState";
import { useGlassRing } from "./hooks/useGlassRing";
import { usePresetActions } from "./hooks/usePresetActions";
import { useMarqueeSelection } from "./hooks/useMarqueeSelection";
import { useViewAnimation, VIEW_COLLAPSE_MS } from "./hooks/useViewAnimation";
import { useThrottledCompute } from "./hooks/useThrottledCompute";
import AdvancedView from "./components/AdvancedView";
import ConfirmDialog from "./components/ConfirmDialog";
import CurvePanel from "./components/CurvePanel";
import DevicePropsCard from "./components/DevicePropsCard";
import DeviceTabs from "./components/DeviceTabs";
import DragLayer from "./components/DragLayer";
import ImportDialog from "./components/ImportDialog";
import InstallDialog from "./components/InstallDialog";
import PresetView from "./components/PresetView";
import SavePresetDialog from "./components/SavePresetDialog";
import SelectionToolbar from "./components/SelectionToolbar";
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
  const handleUninstalled = useCallback(
    (name: string) => notify(t("notify.uninstalled", { name })),
    [notify],
  );
  const [installBusy, setInstallBusy] = useState(false);

  const {
    selectedGuid,
    setSelectedGuid,
    selected,
    devices,
    loading,
    refresh,
    installedDevices,
    uninstallTarget,
    setUninstallTarget,
    uninstalling,
    confirmUninstall,
  } = useDevices(onError, handleUninstalled, installBusy);

  const channelNames = useMemo(() => channelNamesFor(selected?.channels), [selected?.channels]);
  const { channelOn, setChannelOn, setActiveChannel, effActiveChannel, firstChannel } =
    useChannelState(selectedGuid, channelNames);

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
    configChannelMode,
    loaded,
    forceReload,
    deviceTuningOn,
    toggleDeviceTuning,
  } = useConfig(installedDevices.length === 0 ? null : selectedGuid, onError, notify, {
    mode: channelOn,
    first: channelNames[0] ?? "L",
    active: effActiveChannel,
  }, installedDevices.map((d) => d.guid));

  const { theme, setTheme } = useTheme();
  const { isMax, minimize, toggleMaximize, close } = useWindowControls();

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
  const fs = selected?.sample_rate ?? 48000;
  // 峰值/谷值曲线计算较重（31 段 × 数百评估点），拖动滑块时固定间隔重算
  //（默认 120ms），滑块 move 只重渲染被拖的卡片，保证拖动帧数。
  const deferredCurve = useThrottledCompute(() => {
    const freqs = buildEvalFreqs(visibleBlocks);
    const range = curveRange(freqs, visibleBlocks, fs, preampGainDb);
    return { freqs, peak: range.max, trough: range.min };
  }, [visibleBlocks, fs, preampGainDb]);
  const { peakGain, troughGain } = useMemo(() => {
    if (deferredCurve) {
      return { peakGain: deferredCurve.peak, troughGain: deferredCurve.trough };
    }
    const freqs = buildEvalFreqs(visibleBlocks);
    const range = curveRange(freqs, visibleBlocks, fs, preampGainDb);
    return {
      peakGain: range.max,
      troughGain: range.min,
    };
  }, [deferredCurve, visibleBlocks, fs, preampGainDb]);
  const yTop = Math.max(6, Math.min(30, Math.ceil((peakGain + 1) / 2) * 2));
  const yBottom = Math.min(-6, Math.max(-30, Math.floor((troughGain - 1) / 2) * 2));

  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [bodyNode, setBodyNode] = useState<HTMLDivElement | null>(null);
  const devFxRef = useRef<HTMLDivElement | null>(null);
  useGlassRing(devFxRef);
  // 设备切换时滚动容器会重挂载：用回调 ref 把当前节点同步给滚动条，
  // 滚动条组件本身不卸载，才能做平滑淡出。
  const setBodyRef = useCallback((el: HTMLDivElement | null) => {
    bodyRef.current = el;
    setBodyNode(el);
  }, []);
  const [hintShift, setHintShift] = useState(0);

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

  // 事件期跨 hook 引用（打破 preset↔marquee↔view 依赖环）
  const accentOfRef = useRef<(b: Block) => string>(() => "#519741");
  const selectedIdsRef = useRef<string[]>([]);
  const cancelToolbarAnimRef = useRef<() => void>(() => {});
  const bumpSelGeomTickRef = useRef<() => void>(() => {});

  const {
    view,
    side,
    setSide,
    setView,
    segDir,
    setSegDir,
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
  } = useViewAnimation({
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
  });

  // 通道选择器开关跟随磁盘配置：重启/切换设备后从 per-channel 数据还原，
  // 避免界面停在“关”而配置实际是分通道的（还会在保存时丢掉非首通道块）。
  // 通道模式下必须落在参数视图（通道选择器只存在于参数视图，preset 按钮此时也禁用）。
  useEffect(() => {
    if (!loaded) return;
    setChannelOn(configChannelMode);
    if (configChannelMode) {
      setSegDir("right");
      setView("advanced");
    }
  }, [loaded, configChannelMode, setChannelOn, setSegDir, setView]);

  const {
    selectedIds,
    setSelectedIds,
    copyOpen,
    setCopyOpen,
    marquee,
    selGeom,
    selGeomReady,
    onBodyPointerDown,
    onBodyPointerMove,
    onBodyPointerUp,
    deleteSelectedCards,
    copySelectedToChannel,
    toolbarElRef,
    cancelToolbarAnim,
    bumpSelGeomTick,
  } = useMarqueeSelection({
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
  });
  cancelToolbarAnimRef.current = cancelToolbarAnim;
  bumpSelGeomTickRef.current = bumpSelGeomTick;

  const {
    customPresets,
    savePresetOpen,
    setSavePresetOpen,
    savePresetBlocks,
    savePresetDefaultName,
    deletePresetTarget,
    usedPresetList,
    accentOf,
    openSavePreset,
    handleApplyPreset,
    handleSavePreset,
    confirmDeletePreset,
    closeDeletePreset,
    setDeletePresetTarget,
  } = usePresetActions({
    blocks,
    selectedIds,
    applyPreset,
    notify,
    clearSelection: () => setSelectedIds([]),
  });
  accentOfRef.current = accentOf;
  selectedIdsRef.current = selectedIds;

  // 设备切换时保存旧设备通道状态并恢复新设备通道状态（逐设备记忆，
  // 原逻辑在通道记忆 effect 内一并清空选中）。
  const prevGuidClearRef = useRef<string | null>(selectedGuid);
  useEffect(() => {
    if (prevGuidClearRef.current === selectedGuid) return;
    prevGuidClearRef.current = selectedGuid;
    setSelectedIds([]);
    setCopyOpen(false);
  }, [selectedGuid]);

  const handleChannelChange = useCallback((ch: string) => {
    setActiveChannel(ch);
    setSelectedIds([]);
    setCopyOpen(false);
  }, []);
  const handleCurveChannelChange = useCallback(
    (v: string) => {
      if (channelOn) {
        setActiveChannel(v);
        setSelectedIds([]);
        setCopyOpen(false);
      }
    },
    [channelOn],
  );
  const handleAddBand = useCallback(
    (kind: PeqBandKind) => addBand(kind, effActiveChannel),
    [addBand, effActiveChannel],
  );
  const handleToggleCopy = useCallback(() => setCopyOpen((o) => !o), []);
  const handleToggleMaximize = useCallback(() => void toggleMaximize(), [toggleMaximize]);
  const handleInstalled = useCallback((name: string) => notify(t("notify.installed", { name })), [notify]);
  const openUninstall = useCallback(
    (d: Device) => {
      setSelectedIds([]);
      setCopyOpen(false);
      setUninstallTarget(d);
    },
    [setUninstallTarget],
  );

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [installOpen, setInstallOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importDeviceGuid, setImportDeviceGuid] = useState<string | null>(null);

  const toggleChannel = useCallback(() => {
    markDirty();
    // 只有通道切换会伴随视图切到 advanced 时才需要 view-stage 动画；
    // 已处于 advanced 时直接清空选择即可，不触发视图退场/进场。
    if (view !== "advanced") beginViewAnim(); else setCopyOpen(false);
    setCopyOpen(false);
    setSelectedIds([]);
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

  const openSettings = useCallback(() => {
    // 打开设置前清除框选，避免浮窗悬空在点击层。
    setSelectedIds([]);
    setCopyOpen(false);
    setSettingsOpen(true);
  }, []);
  const openInstall = useCallback(() => {
    setSelectedIds([]);
    setCopyOpen(false);
    setInstallOpen(true);
  }, []);
  const openImport = useCallback(() => {
    setSelectedIds([]);
    setCopyOpen(false);
    const guid = selectedGuid ?? installedDevices[0]?.guid ?? null;
    setImportDeviceGuid(guid);
    setImportOpen(true);
  }, [selectedGuid, installedDevices]);
  const handleImport = useCallback(
    async (guid: string, content: string) => {
      try {
        const parsed = parseConfigWithTail(content);
        if (parsed.tail.trim()) {
          notify(t("import.fail.unknown"));
          return;
        }
        await writeConfig(guid, content);
        setSelectedGuid(guid);
        forceReload();
        setImportOpen(false);
        notify(t("import.success"));
      } catch (e) {
        notify(`${t("import.fail")}：${friendlyError(e)}`);
      }
    },
    [notify, setSelectedGuid, forceReload],
  );
  const handleExport = useCallback(() => {
    if (!selectedGuid) return;
    exportConfig(selectedGuid).catch((e: unknown) => notify(`${t("export.fail")}：${friendlyError(e)}`));
  }, [selectedGuid, notify]);

  const normalizeGain = useCallback(() => {
    const { updates } = planNormalize(blocks, effects, channelNames, channelOn, fs);
    if (!updates.length) {
      notify(t("normalize.title.disabled"));
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
      notify(t("notify.normalizedByChannel", { summary }));
    } else {
      const u = updates[0];
      notify(
        t("notify.normalized", {
          db: `${u.gain_db > 0 ? "+" : ""}${u.gain_db.toFixed(1)}`,
        }),
      );
    }
  }, [blocks, channelOn, channelNames, effects, fs, markDirty, notify]);

  const closeUninstall = useCallback((open: boolean) => {
    if (!open) setUninstallTarget(null);
  }, []);
  const handleConfirmUninstall = useCallback(() => {
    void confirmUninstall();
  }, [confirmUninstall]);

  const channelCounts = useMemo(
    () => channelNames.map((c) => channelBandCounts[c] ?? 0),
    [channelNames, channelBandCounts],
  );
  const lang = useI18n();
  return (
    <div key={lang} className="app-shell-new">
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
        {loading ? (
          <>
            <aside className="sidebar app-loading-sidebar" />
            <main className="content app-loading-content" />
          </>
        ) : (
          <>
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

            <main className={`content${installedDevices.length === 0 ? " is-empty" : ""}`}>
          <DeviceTabs
            devices={installedDevices}
            selectedGuid={selectedGuid}
            tuningOn={deviceTuningOn}
            onSelect={setSelectedGuid}
            onToggleTuning={toggleDeviceTuning}
            onUninstall={openUninstall}
            onAdd={openInstall}
          />

          <div className="device-body">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={selectedGuid ?? "none"}
                className="device-page"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18, ease: "easeInOut" }}
              >
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
                  <span className="no-device-tip">{t("no.device")}</span>
                </button>
              </div>
            ) : (
              <>
            <div
              className="tuning-scroll os-scroll"
              ref={setBodyRef}
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
                  initial={{ x: "-100%", opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  exit={{ x: "-100%", opacity: 0 }}
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
                  initial={{ x: "100%", opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  exit={{ x: "100%", opacity: 0 }}
                  transition={{ duration: 0.32, ease: "easeInOut" }}
                >
                  <AdvancedView
                    blocks={blocks}
                    showFilterEmptyHint={blocks.length === 0}
                    showEffectEmptyHint={visibleEffects.length === 0}
                    hintShift={hintShift}
                    accentOf={accentOf}
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

            <AnimatePresence mode="wait" initial={false}>
              {selGeom && selectedIds.length > 0 && !toolbarHidden && selGeomReady && (
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
              <div className="fx fx-dev" ref={devFxRef}>
                <DevicePropsCard
                  device={selected}
                  peakGain={peakGain}
                  totalBands={totalBands}
                  channelOn={channelOn}
                  channelCounts={channelCounts}
                  onNormalize={normalizeGain}
                />
              </div>
              <CurvePanel
                blocks={blocks}
                fs={selected?.sample_rate ?? 48000}
                yTop={yTop}
                yBottom={yBottom}
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
              </motion.div>
            </AnimatePresence>
            <OverlayScrollbar
              targetRef={bodyRef}
              target={bodyNode}
              deviceKey={selectedGuid ?? "none"}
              rightPx={-2}
              thumbRight={-2}
              bottomInset={26}
            />
          </div>
            </main>
          </>
        )}
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
        title={t("notify.presetDeleted")}
        message={
          deletePresetTarget ? t("confirm.deletePreset", { name: deletePresetTarget.name }) : ""
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
        onRefresh={refresh}
        onInstalled={handleInstalled}
        onBusyChange={setInstallBusy}
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
