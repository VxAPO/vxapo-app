import { useCallback, useMemo, useState, type ReactNode } from "react";
import "./App.css";
import "./new.css";
import type { SideSection, ViewMode } from "./lib/model";
import { buildRenderOrder, buildSortItems, groupBlocks } from "./lib/blocks";
import { LIBRARY } from "./data/library";
import { useConfig } from "./hooks/useConfig";
import { useDevices } from "./hooks/useDevices";
import { useDragSort } from "./hooks/useDragSort";
import { useTheme } from "./hooks/useTheme";
import { useToast } from "./hooks/useToast";
import { useWindowControls } from "./hooks/useWindowControls";
import { peakingDb } from "./components/CurvePlot";
import AdvancedView from "./components/AdvancedView";
import BandParamCard from "./components/BandParamCard";
import CurvePanel from "./components/CurvePanel";
import DevicePropsCard from "./components/DevicePropsCard";
import DeviceTabs from "./components/DeviceTabs";
import DragLayer from "./components/DragLayer";
import PresetView from "./components/PresetView";
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
    installedDevices,
    uninstallTarget,
    setUninstallTarget,
    uninstalling,
    confirmUninstall,
  } = useDevices(onError);

  const {
    blocks,
    setBlocks,
    markDirty,
    applyPreset,
    addBand,
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
  const [curveChannel, setCurveChannel] = useState("左声道");

  const groups = useMemo(() => groupBlocks(blocks), [blocks]);
  const renderOrder = useMemo(() => buildRenderOrder(blocks, groups), [blocks, groups]);
  const sortItems = useMemo(() => buildSortItems(renderOrder), [renderOrder]);

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

  const overlayContent = useCallback(
    (key: string, num: number): ReactNode => {
      const item = sortItems.find((x) => x.key === key);
      if (item) {
        return (
          <SemanticUnitCard
            item={item}
            dragNum={null}
            num={num}
            onRemoveBlock={removeBlock}
            onRemoveGroup={removeGroup}
            onPatchBand={patchBand}
          />
        );
      }
      const bi = blocks.findIndex((b) => b.id === key);
      const b = bi >= 0 ? blocks[bi] : undefined;
      return b ? (
        <BandParamCard
          block={b}
          index={bi}
          dragNum={null}
          num={num}
          onRemoveBlock={removeBlock}
          onPatchBlock={patchBlock}
          onPatchBand={patchBand}
        />
      ) : null;
    },
    [sortItems, blocks, removeBlock, removeGroup, patchBlock, patchBand],
  );

  const dragApi = useDragSort({ setBlocks, markDirty, overlayContent });

  const overlayClassForKey = (key: string): string => {
    const item = sortItems.find((x) => x.key === key);
    if (item) return item.kind === "standalone" ? "group-card standalone" : "group-card";
    const b = blocks.find((x) => x.id === key);
    return b ? `band-card${b.enabled ? " enabled" : " disabled"}` : "group-card";
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
          onApplyPreset={applyPreset}
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
          />

          <div className="device-body">
            {loadErr && <div className="hint-row show err">{loadErr}</div>}
            {!loadErr && view === "preset" && (
              <PresetView
                items={sortItems}
                blocksEmpty={blocks.length === 0}
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
                activeKey={dragApi.activeKey}
                flyKey={dragApi.fly?.key ?? null}
                virtualIndexOf={dragApi.virtualIndexOf}
                onDragStart={dragApi.startDrag}
                onRemoveBlock={removeBlock}
                onPatchBlock={patchBlock}
                onPatchBand={patchBand}
              />
            )}

            <div className="bottom-row">
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
        onFlyComplete={dragApi.completeFly}
      />
      {notice && <Toast message={notice} />}
    </div>
  );
}
