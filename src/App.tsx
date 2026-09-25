import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import "./App.css";
import "./new.css";
import type { Device } from "./lib/model";
import { channelNamesFor } from "./lib/channels";
import { visibleBlocksFor } from "./lib/filters";
import { exportConfig, friendlyError, writeConfig } from "./lib/api";
import { parseConfigWithTail } from "./lib/toml";
import { snapPx } from "./lib/snap";
import { axisRange, buildEvalFreqs, curveRange } from "./lib/curve";
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
import { playStaggerIn } from "./lib/staggerIn";
import { driveFor } from "./lib/edgetint/renderLoop";

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
    loading,
    installedDevices,
    setUninstallTarget,
    staleInstalls,
    staleBusy,
    migrateStaleSafe,
    cleanupStaleSafe,
  } = useDevices(installBusy);

  // 设备页过渡走 AnimatePresence mode="wait"（见下方 JSX）：退出的是**旧的元素实例**，
  // 它带着旧设备的 props 淡出，新元素带新数据淡入——两段天然串行、不重叠。数据侧因此
  // 即时跟随选中设备即可：不同设备的曲线本来就不同，跟着页面一起换才是对的观感。
  const channelNames = useMemo(() => channelNamesFor(selected?.channels), [selected?.channels]);
  const { channelOn, setChannelOn, setActiveChannel, effActiveChannel, firstChannel } =
    useChannelState(selectedGuid, channelNames);

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
    tuningMap,
    configChannelMode,
    loaded,
    forceReload,
    toggleDeviceTuning,
    setChannelPreampMode,
    normalizeChainGain,
  } = useConfig(installedDevices.length === 0 ? null : selectedGuid, {
    mode: channelOn,
    first: channelNames[0] ?? "L",
    active: effActiveChannel,
  }, installedDevices.map((d) => d.guid));

  const { theme, setTheme } = useTheme();
  const { isMax, minimize, toggleMaximize, close } = useWindowControls();

  // 峰值增益、量程与曲线都跟随**同一个目标声道**：通道模式取当前选中声道，关闭选择器时回退首声道（左）。
  // 判据与两个视图、与 buildToml 的落盘口径同源（lib/filters.visibleBlockFor）——非通道模式**不是**
  // 「算整条链」：各声道的块各自带 channel、驱动侧分开作用，叠出来的那条响应在真实链路里并不存在，
  // 关掉选择器那一瞬间会先画出一条叠加曲线、下一档才回正（踩过）。
  const visibleBlocks = useMemo(
    () => visibleBlocksFor(blocks, channelOn, firstChannel, effActiveChannel),
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
  const fs = selected?.sample_rate ?? 48000;
  /**
   * 频响图的一**份数据快照**：评估频点与峰值/谷值一次算完，量程（`yTop/yBottom`）与曲线路径
   * **必须取自同一份**——`useThrottledCompute` 按设计让渲染侧滞后一档，而绘制侧原先按当前 blocks
   * 现算评估点，两者档位就会不一致：关掉通道选择器那一帧里路径已是新目标、量程还是旧值，曲线于是
   * 按错量程补间一档、下一档才回正——观感就是「过渡第一次取到错误值 / 坐标轴波动」（形状一直是对的，
   * 错的是坐标轴，踩过）。曲线**宽度**仍每次现算（保证与网格/viewBox 一致，拖拽改宽度不越界）。
   */
  const liveCurve = useMemo(() => {
    const freqs = buildEvalFreqs(visibleBlocks);
    const range = curveRange(freqs, visibleBlocks, fs, preampGainDb);
    return { blocks: visibleBlocks, freqs, peak: range.max, trough: range.min };
  }, [visibleBlocks, fs, preampGainDb]);
  // 曲线计算较重（31 段 × 数百评估点），按固定间隔节流；首帧 deferred 还是 null，直接用现算的这份
  const deferredCurve = useThrottledCompute(() => liveCurve, [visibleBlocks, fs, preampGainDb]);
  const curveSnap = deferredCurve ?? liveCurve;
  const peakGain = curveSnap.peak;
  // 纵轴量程：峰值/谷值取整到 2dB 档，并对齐到刻度步长（否则网格首末两条压不住绘图区上下沿，
  // 表现为"虚线没贴住纵轴顶端、刻度数字整体偏移"，见 lib/curve.axisRange）
  const { top: yTop, bottom: yBottom } = useMemo(
    () => axisRange(curveSnap.peak, curveSnap.trough),
    [curveSnap],
  );

  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [bodyNode, setBodyNode] = useState<HTMLDivElement | null>(null);
  /** 拖拽悬浮层的挂载容器（`.device-body`，带 clip-path）：挂进去才会被裁在内容区边界 */
  const [devBodyNode, setDevBodyNode] = useState<HTMLDivElement | null>(null);
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
    segDir,
    toolbarHidden,
    viewTransitionH,
    viewCollapsing,
    viewCollapseMs,
    viewMorph,
    viewRef,
    viewAnimating,
    viewAnimatingRef,
    switchView,
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
  // 从磁盘配置读出的通道模式同步到 store。**不再强制切到参数视图**：语义视图同样按声道过滤内容
  // （`PresetView` 的 `visible`），声道切换入口是曲线卡上的选择器——它在两个视图里都在。
  useEffect(() => {
    if (!loaded) return;
    setChannelOn(configChannelMode);
  }, [loaded, configChannelMode, setChannelOn]);

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
  const prevGuidClearRef = useRef<string | null>(selectedGuid);
  useEffect(() => {
    if (prevGuidClearRef.current === selectedGuid) return;
    prevGuidClearRef.current = selectedGuid;
    setSelectedIds([]);
    setCopyOpen(false);
  }, [selectedGuid]);

  // 染色 canvas 在设备页过渡期间要持续重绘：过渡由 framer-motion 驱动 DOM，canvas 不感知，
  // 得显式开一段重绘窗口（两段淡出淡入 + 余量）。
  // 滚动位置不必显式复位：`.device-page` 仍按设备重挂载，`.tuning-scroll` 在它内部，天然回顶。
  useEffect(() => {
    driveFor(DEVICE_FADE_MS * 2 + 120, "full");
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

  /** 上一次播过错峰的 device-page 元素：用来判断「新的一页出现了」 */
  const devPageRef = useRef<HTMLElement | null>(null);

  /** 视图切换：新视图刚进 DOM 就播卡片错峰淡入。
      useLayoutEffect（绘制前）而不是 useEffect，否则可能先看到整块视图再被拉回 0 闪一下。 */
  useLayoutEffect(() => {
    if (!viewAnimating) return;
    playStaggerIn(document.querySelector<HTMLElement>(".view-stage.is-active"));
  }, [viewAnimating]);

  /**
   * 设备页切换：`AnimatePresence mode="wait"` 先让旧页淡出、再挂新页，
   * 所以用 rAF 等「新的 .device-page 出现」再播错峰——比拍一个固定延时稳，日后改淡出时长也不会失准。
   * 等不到（无设备 / 加载失败）就两秒后放弃，不留空转的 rAF。
   */
  useLayoutEffect(() => {
    let raf = 0;
    let frames = 0;
    const tick = () => {
      const el = document.querySelector<HTMLElement>(".device-page");
      if (el && el !== devPageRef.current) {
        devPageRef.current = el;
        playStaggerIn(el);
        return;
      }
      if (++frames > 120) return;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [selectedGuid]);

  const toggleChannel = useCallback(() => {
    setCopyOpen(false);
    setSelectedIds([]);
    // 基准电平的拆分/合并（配置域逻辑）在 configStore 内完成；传入切换前的 channelOn。
    setChannelPreampMode(channelOn, channelNames);
    setChannelOn((v) => !v);
    // 不再强制切到参数视图：语义视图也按声道过滤（`PresetView` 的 `visible`），
    // 声道切换入口是曲线卡上的选择器，两个视图都能用。
    blocksDragApi.cancelDrag();
    effectsDragApi.cancelDrag();
  }, [
    channelOn,
    channelNames,
    setChannelPreampMode,
    setChannelOn,
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
            tuningMap={tuningMap}
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

          <div className="device-body" ref={setDevBodyNode}>
            {/* 设备页过渡（拆分前原实现）：AnimatePresence mode="wait" + key=设备。
                退出的旧元素实例带着旧数据淡出，新元素带新数据淡入，两段串行、不重叠。 */}
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={selectedGuid ?? "none"}
                className="device-page"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{
                  opacity: 0,
                  transition: { duration: DEVICE_FADE_MS / 1000, ease: "easeInOut" },
                }}
                transition={{
                  // 进场不补间 opacity（退场的淡出在上面单独给）：淡入交给卡片错峰，
                  // 整体再淡一层会和卡片自己的淡入相乘，卡片永远亮不满
                  duration: DEVICE_FADE_MS / 1000,
                  ease: "easeInOut",
                  opacity: { duration: 0 },
                }}
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
                blocks={blocks}
                effects={effects}
                channelOn={channelOn}
                activeChannel={effActiveChannel}
                channelNames={channelNames}
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
                  device={selected}
                  peakGain={peakGain}
                  totalBands={totalBands}
                  channelOn={channelOn}
                  channelCounts={channelCounts}
                  onNormalize={normalizeGain}
                />
              </div>
              <CurvePanel
                /* 交给绘制侧的是**快照里的那一份**：与 yTop/yBottom 同档，避免按当前 blocks 现算导致
                   路径与量程错开一档（见上面 liveCurve 的注释） */
                blocks={curveSnap.blocks}
                evalFreqs={curveSnap.freqs}
                fs={fs}
                yTop={yTop}
                yBottom={yBottom}
                preampGainDb={preampGainDb}
                curveChannel={channelOn ? effActiveChannel : firstChannel}
                onCurveChannelChange={handleCurveChannelChange}
                channelOn={channelOn}
                channelNames={channelNames}
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
        flyHost={bodyNode}
        overlayHost={devBodyNode}
        classForKey={overlayClassForKey}
        styleForKey={overlayStyleForKey}
        effectClassForKey={effectOverlayClassForKey}
      />
    </div>
  );
}
