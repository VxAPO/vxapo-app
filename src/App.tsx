import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence } from "framer-motion";
import "./App.css";
import "./new.css";
import type { Device } from "./lib/model";
import { channelNamesFor } from "./lib/channels";
import { exportConfig, friendlyError, writeConfig } from "./lib/api";
import { parseConfigWithTail } from "./lib/toml";
import { snapPx } from "./lib/snap";
import { buildEvalFreqs, curveRange } from "./lib/curve";
import { useConfig } from "./hooks/useConfig";
import { useDevices } from "./hooks/useDevices";
import { useSelectionStore } from "./stores/selectionStore";
import { useUiStore } from "./stores/uiStore";
import NoDeviceHint from "./components/NoDeviceHint";
import MarqueeBox from "./components/MarqueeBox";
import ViewStage from "./components/ViewStage";
import AppOverlays from "./components/AppOverlays";
import { useTheme } from "./hooks/useTheme";
import { useI18n } from "./lib/i18n";
import { t } from "./lib/i18n/core";
import { useWindowControls } from "./hooks/useWindowControls";
import OverlayScrollbar from "./components/OverlayScrollbar";
import { useChannelState } from "./hooks/useChannelState";
import { useGlassRing } from "./hooks/useGlassRing";
import { useEdgeTintLayer } from "./hooks/useEdgeTintLayer";
import { usePresetActions } from "./hooks/usePresetActions";
import { useMarqueeSelection } from "./hooks/useMarqueeSelection";
import {
  useViewAnimation,
} from "./hooks/useViewAnimation";
import { useThrottledCompute } from "./hooks/useThrottledCompute";
import { DEVICE_FADE_MS } from "./lib/viewMotion";
import { useDeviceSwapFade, useFrozenWhile } from "./hooks/useDeviceSwapFade";

/**
 * 设备卡"静置重绘"心跳（只针对这一张卡）。
 * Chromium 在滚动后只对设备卡的 backdrop 背板做增量重采，blur outset 覆盖的右缘一圈会残留
 * 旧 texel（4~7px、外强内弱的白边），并一直挂着——因为性能优化把静置期重绘去掉了，没人再
 * 清它。这里只给设备卡恢复一次低频率的真实 paint 变更（全透明渐变 ↔ none），
 * 让该卡所在 chunk 周期性重新光栅化、背板重采；其余元素仍是 0 静置重绘。
 */
import CurvePanel from "./components/CurvePanel";
import DevicePropsCard from "./components/DevicePropsCard";
import DeviceTabs from "./components/DeviceTabs";
import SelectionToolbar from "./components/SelectionToolbar";
import Sidebar from "./components/Sidebar";
import StaleInstallBanner from "./components/StaleInstallBanner";
import TopBar from "./components/TopBar";

/** 底部悬浮条预留高度：保证最后一行卡片能完全滚到悬浮条上方 */
const BOTTOM_BAR_PAD = 400;

export default function App() {
  // 错误条 / Toast / 对话框开关收进 uiStore（决策 4 阶段 A 收尾）。
  const loadErr = useUiStore((s) => s.loadErr);
  const notify = useUiStore((s) => s.notify);
  const installBusy = useUiStore((s) => s.installBusy);

  const {
    selectedGuid,
    setSelectedGuid,
    selected,
    devices,
    loading,
    installedDevices,
    setUninstallTarget,
    staleInstalls,
    staleBusy,
    migrateStaleSafe,
    cleanupStaleSafe,
  } = useDevices(installBusy);

  // 设备页过渡：页面数据源滞后一拍（旧页淡完才换内容再淡入，见 hooks/useDeviceSwapFade）
  const { shown: shownGuid, opacity: pageOpacity, swapping } = useDeviceSwapFade(selectedGuid);
  const shownDevice = useMemo(
    () => devices.find((d) => d.guid === shownGuid) ?? null,
    [devices, shownGuid],
  );

  // 通道状态**即时**跟随选中设备：侧边栏的通道选择器读的是 channelStore，
  // 这里若挂滞后一拍的 guid，整块侧边栏会等页面淡出完才更新。
  const liveChannelNames = useMemo(
    () => channelNamesFor(selected?.channels),
    [selected?.channels],
  );
  const {
    channelOn: liveChannelOn,
    setChannelOn,
    setActiveChannel,
    effActiveChannel: liveActiveChannel,
  } = useChannelState(selectedGuid, liveChannelNames);

  // 页面内容用滞后一份的通道状态（侧边栏用上面的即时值）：
  // 否则旧页淡出到一半会突然按新设备的通道开关/活动声道重排。
  const channelNames = useMemo(
    () => channelNamesFor(shownDevice?.channels),
    [shownDevice?.channels],
  );
  const channelOn = useFrozenWhile(swapping, liveChannelOn);
  const effActiveChannel = useFrozenWhile(swapping, liveActiveChannel);
  const firstChannel = channelNames[0] ?? "L";

  // 残留迁移/清理的错误上报已在 deviceStore 的 safe 动作内完成（决策 4 阶段 A）。

  const {
    blocks,
    setBlocks,
    effects,
    setEffects,
    markDirty,
    applyPreset,
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
    setChannelPreampMode,
    normalizeChainGain,
  } = useConfig(installedDevices.length === 0 ? null : shownGuid, {
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
  // 通道过滤后的效果器列表已由两个视图各自订阅计算（决策 4 阶段 A-2b）。
  const fs = shownDevice?.sample_rate ?? 48000;
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
  useEdgeTintLayer(devFxRef);
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

  // 选中集与工具栏联动改由 selectionStore 承载（决策 4 阶段 B，替代原先四个跨 hook ref）。

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
    viewCollapseMs,
    viewMorph,
    viewRef,
    viewAnimatingRef,
    switchView,
    beginViewAnim,
    blocksDragApi,
    effectsDragApi,
    overlayClassForKey,
    overlayStyleForKey,
    effectOverlayClassForKey,
    handleStageAnimationComplete,
    hiddenStage,
    stageWarm,
  } = useViewAnimation({
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
    marqueeToolbarSuppressed,
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
  // 决策 4 阶段 B：这些联动在渲染提交后写入 selectionStore（不再渲染期写 ref）。
  useEffect(() => {
    const s = useSelectionStore.getState();
    s.setCancelToolbarAnim(cancelToolbarAnim);
    s.setBumpSelGeomTick(bumpSelGeomTick);
    s.setAccentOf(accentOf);
    s.setSelectedIds(selectedIds);
  }, [cancelToolbarAnim, bumpSelGeomTick, accentOf, selectedIds]);

  // 设备切换时保存旧设备通道状态并恢复新设备通道状态（逐设备记忆，
  // 原逻辑在通道记忆 effect 内一并清空选中）。
  const prevGuidClearRef = useRef<string | null>(shownGuid);
  useEffect(() => {
    if (prevGuidClearRef.current === shownGuid) return;
    prevGuidClearRef.current = shownGuid;
    setSelectedIds([]);
    setCopyOpen(false);
  }, [shownGuid]);

  // 换设备后滚动位置归零：旧实现靠 .device-page 按设备重挂载天然归零，
  // 现在元素常驻（过渡不再重挂载），需要显式复位。
  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = 0;
  }, [shownGuid]);

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

  const toggleChannel = useCallback(() => {
    // 只有通道切换会伴随视图切到 advanced 时才需要 view-stage 动画；
    // 已处于 advanced 时直接清空选择即可，不触发视图退场/进场。
    if (view !== "advanced") beginViewAnim();
    setCopyOpen(false);
    setSelectedIds([]);
    // 基准电平的拆分/合并（配置域逻辑）在 configStore 内完成；传入切换前的 channelOn。
    setChannelPreampMode(channelOn, channelNames);
    setChannelOn((v) => !v);
    setView("advanced");
    setSegDir("right");
    blocksDragApi.cancelDrag();
    effectsDragApi.cancelDrag();
  }, [
    channelOn,
    channelNames,
    view,
    setChannelPreampMode,
    beginViewAnim,
    setChannelOn,
    setView,
    setSegDir,
    blocksDragApi.cancelDrag,
    effectsDragApi.cancelDrag,
  ]);

  const openSettings = useCallback(() => {
    // 打开设置前清除框选，避免浮窗悬空在点击层。
    setSelectedIds([]);
    setCopyOpen(false);
    useUiStore.getState().setSettingsOpen(true);
  }, []);
  const openInstall = useCallback(() => {
    setSelectedIds([]);
    setCopyOpen(false);
    useUiStore.getState().setInstallOpen(true);
  }, []);
  const openImport = useCallback(() => {
    setSelectedIds([]);
    setCopyOpen(false);
    const ui = useUiStore.getState();
    ui.setImportDeviceGuid(selectedGuid ?? installedDevices[0]?.guid ?? null);
    ui.setImportOpen(true);
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
        useUiStore.getState().setImportOpen(false);
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
    normalizeChainGain(fs, channelNames, channelOn);
  }, [normalizeChainGain, fs, channelNames, channelOn]);

  // 卸载对话框的开关/确认已随 AppOverlays 抽出（内部直接订阅 deviceStore）。

  const channelCounts = useMemo(
    () => channelNames.map((c) => channelBandCounts[c] ?? 0),
    [channelNames, channelBandCounts],
  );
  const lang = useI18n();
  return (
    <div key={lang} className="app-shell-new">
      <TopBar
        view={view}
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
              side={side}
              onSideChange={setSide}
              customPresets={customPresets}
              usedPresets={usedPresetList}
              onApplyPreset={handleApplyPreset}
              onDeletePreset={setDeletePresetTarget}
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
          <StaleInstallBanner
            items={staleInstalls}
            selectedGuid={selectedGuid}
            busy={staleBusy}
            onMigrate={migrateStaleSafe}
            onCleanup={cleanupStaleSafe}
            onDone={notify}
          />

          <div className="device-body">
            {/* 设备页过渡：数据源滞后一拍（useDeviceSwapFade）——旧页淡完才换内容再淡入，
                两段严格串行；元素不按设备重挂载，染色 canvas 也不必重新登记目标。 */}
            <div
              className="device-page"
              style={{ opacity: pageOpacity, transitionDuration: `${DEVICE_FADE_MS}ms` }}
            >
            {installedDevices.length === 0 ? (
              <NoDeviceHint />
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
            {!loadErr && (
              <ViewStage
                view={view}
                stageWarm={stageWarm}
                hiddenStage={hiddenStage}
                viewTransitionH={viewTransitionH}
                viewCollapsing={viewCollapsing}
                viewCollapseMs={viewCollapseMs}
                hintShift={hintShift}
                selectedIds={selectedIds}
                accentOf={accentOf}
                blocksDrag={blocksDragApi}
                effectsDrag={effectsDragApi}
                onChannelChange={handleChannelChange}
                onStageAnimationComplete={handleStageAnimationComplete}
              />
            )}

            <AnimatePresence mode="wait" initial={false}>
              {selGeom && selectedIds.length > 0 && !toolbarHidden && selGeomReady && !marqueeToolbarSuppressed && (
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
            {marquee && <MarqueeBox marquee={marquee} />}
            </div>
            <div className="bottom-row">
              <div className="fx fx-dev" ref={devFxRef}>
                <DevicePropsCard
                  device={shownDevice}
                  peakGain={peakGain}
                  totalBands={totalBands}
                  channelOn={channelOn}
                  channelCounts={channelCounts}
                  onNormalize={normalizeGain}
                />
              </div>
              <CurvePanel
                blocks={blocks}
                fs={fs}
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
            </div>
            <OverlayScrollbar
              targetRef={bodyRef}
              target={bodyNode}
              deviceKey={shownGuid ?? "none"}
              rightPx={-2}
              thumbRight={-2}
              bottomInset={26}
              morph={viewMorph}
            />
          </div>
            </main>
          </>
        )}
      </div>

      <AppOverlays
        theme={theme}
        onThemeChange={setTheme}
        savePresetOpen={savePresetOpen}
        onSavePresetOpenChange={setSavePresetOpen}
        savePresetBlocks={savePresetBlocks}
        savePresetDefaultName={savePresetDefaultName}
        onSavePreset={handleSavePreset}
        deletePresetTarget={deletePresetTarget}
        onCloseDeletePreset={closeDeletePreset}
        onConfirmDeletePreset={confirmDeletePreset}
        onImport={handleImport}
        onInstalled={handleInstalled}
        blocksDrag={blocksDragApi}
        effectsDrag={effectsDragApi}
        classForKey={overlayClassForKey}
        styleForKey={overlayStyleForKey}
        effectClassForKey={effectOverlayClassForKey}
      />
    </div>
  );
}
