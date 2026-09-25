// 应用级浮层：设置/预设/导入/安装/卸载对话框、拖拽层与 Toast（从 App.tsx 抽出）。
//
// 设备相关的数据与动作（设备表、残留、卸载目标、刷新）在组件内直接订阅 deviceStore；
// 其余仍需外部传入（主题、预设流程、导入流程、拖拽 API）。
import { AnimatePresence } from "framer-motion";
import type { ComponentProps } from "react";
import { t } from "../lib/i18n/core";
import { isInstalled } from "../lib/api";
import type { Block, PresetLibraryEntry } from "../lib/model";
import type { FlyState } from "../lib/dragSortTypes";
import { useDeviceStore } from "../stores/deviceStore";
import { useUiStore } from "../stores/uiStore";
import ConfirmDialog from "./ConfirmDialog";
import DragLayer from "./DragLayer";
import ImportDialog from "./ImportDialog";
import InstallDialog from "./InstallDialog";
import SavePresetDialog from "./SavePresetDialog";
import SettingsDialog from "./SettingsDialog";
import Toast from "./Toast";
import UninstallDialog from "./UninstallDialog";

/** useDragSort 返回值中本组件用到的部分。 */
interface DragSourceApi {
  activeKey: string | null;
  dragSize: { width: number; height: number } | null;
  fly: FlyState | null;
  overlayRef: React.RefObject<HTMLDivElement | null>;
  /** 飞行副本元素 ref：useDragSort 在滚动补偿里按它命令式平移 */
  flyElRef: React.RefObject<HTMLDivElement | null>;
  overlayNum: number;
  renderOverlay: (key: string, num: number) => React.ReactNode;
}

interface AppOverlaysProps {
  // 设置（开关与 Toast 在组件内订阅 uiStore）
  theme: ComponentProps<typeof SettingsDialog>["theme"];
  onThemeChange: ComponentProps<typeof SettingsDialog>["onThemeChange"];
  // 保存预设
  savePresetOpen: boolean;
  onSavePresetOpenChange: (open: boolean) => void;
  savePresetBlocks: Block[];
  savePresetDefaultName: string;
  onSavePreset: (name: string, desc: string, color: string, descriptions: string[]) => void;
  // 删除预设
  deletePresetTarget: PresetLibraryEntry | null;
  onCloseDeletePreset: (open: boolean) => void;
  onConfirmDeletePreset: () => void;
  // 导入
  onImport: (guid: string, content: string) => void;
  // 安装
  onInstalled: (name: string) => void;
  // 拖拽层
  blocksDrag: DragSourceApi;
  effectsDrag: DragSourceApi;
  /** 飞行副本的挂载容器（滚动内容层 `.tuning-scroll`）：副本必须挂进容器才随内容滚 */
  flyHost: HTMLElement | null;
  /** 抓取悬浮层的挂载容器（`.device-body`）：吃它的 clip-path 裁剪，且不能是滚动容器 */
  overlayHost: HTMLElement | null;
  classForKey: (key: string) => string;
  styleForKey: (key: string) => React.CSSProperties | undefined;
  effectClassForKey: (key: string) => string;
}

export default function AppOverlays({
  theme,
  onThemeChange,
  savePresetOpen,
  onSavePresetOpenChange,
  savePresetBlocks,
  savePresetDefaultName,
  onSavePreset,
  deletePresetTarget,
  onCloseDeletePreset,
  onConfirmDeletePreset,
  onImport,
  onInstalled,
  blocksDrag,
  effectsDrag,
  flyHost,
  overlayHost,
  classForKey,
  styleForKey,
  effectClassForKey,
}: AppOverlaysProps) {
  // UI 开关与 Toast 直接订阅 uiStore（决策 4 阶段 A 收尾）；沿用原 prop 名，JSX 无需改。
  const settingsOpen = useUiStore((s) => s.settingsOpen);
  const onSettingsOpenChange = useUiStore((s) => s.setSettingsOpen);
  const installOpen = useUiStore((s) => s.installOpen);
  const onInstallOpenChange = useUiStore((s) => s.setInstallOpen);
  const importOpen = useUiStore((s) => s.importOpen);
  const onImportOpenChange = useUiStore((s) => s.setImportOpen);
  const importDeviceGuid = useUiStore((s) => s.importDeviceGuid);
  const onSelectImportDevice = useUiStore((s) => s.setImportDeviceGuid);
  const onInstallBusyChange = useUiStore((s) => s.setInstallBusy);
  const notice = useUiStore((s) => s.notice);
  // 设备域数据/动作直接订阅（决策 4 阶段 A）。
  const devices = useDeviceStore((s) => s.devices);
  const installedDevices = devices.filter(isInstalled);
  const staleInstalls = useDeviceStore((s) => s.staleInstalls);
  const staleBusy = useDeviceStore((s) => s.staleBusy);
  const cleanupStaleSafe = useDeviceStore((s) => s.cleanupStaleSafe);
  const refresh = useDeviceStore((s) => s.refresh);
  const uninstallTarget = useDeviceStore((s) => s.uninstallTarget);
  const uninstalling = useDeviceStore((s) => s.uninstalling);
  const setUninstallTarget = useDeviceStore((s) => s.setUninstallTarget);
  const confirmUninstall = useDeviceStore((s) => s.confirmUninstall);

  return (
    <>
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={onSettingsOpenChange}
        theme={theme}
        onThemeChange={onThemeChange}
        staleUnmatched={staleInstalls.filter((s) => s.target_state === "unmatched")}
        staleBusy={staleBusy}
        onCleanupStale={cleanupStaleSafe}
      />
      <SavePresetDialog
        open={savePresetOpen}
        onOpenChange={onSavePresetOpenChange}
        blocks={savePresetBlocks}
        defaultName={savePresetDefaultName}
        onSave={onSavePreset}
      />
      <ConfirmDialog
        open={deletePresetTarget !== null}
        onOpenChange={onCloseDeletePreset}
        title={t("notify.presetDeleted")}
        message={
          deletePresetTarget ? t("confirm.deletePreset", { name: deletePresetTarget.name }) : ""
        }
        onConfirm={onConfirmDeletePreset}
      />
      <ImportDialog
        open={importOpen}
        onOpenChange={onImportOpenChange}
        devices={installedDevices}
        selectedGuid={importDeviceGuid}
        onSelectDevice={onSelectImportDevice}
        onImport={onImport}
      />
      <InstallDialog
        open={installOpen}
        onOpenChange={onInstallOpenChange}
        devices={devices}
        onRefresh={refresh}
        onInstalled={onInstalled}
        onBusyChange={onInstallBusyChange}
      />
      <UninstallDialog
        device={uninstallTarget}
        open={uninstallTarget !== null}
        busy={uninstalling}
        onOpenChange={(open: boolean) => {
          if (!open) setUninstallTarget(null);
        }}
        onConfirm={() => void confirmUninstall()}
      />
      <DragLayer
        activeKey={blocksDrag.activeKey}
        dragSize={blocksDrag.dragSize}
        fly={blocksDrag.fly}
        overlayRef={blocksDrag.overlayRef}
        flyElRef={blocksDrag.flyElRef}
        flyHost={flyHost}
        overlayHost={overlayHost}
        activeContent={
          blocksDrag.activeKey
            ? blocksDrag.renderOverlay(blocksDrag.activeKey, blocksDrag.overlayNum)
            : null
        }
        classForKey={classForKey}
        styleForKey={styleForKey}
      />
      <DragLayer
        activeKey={effectsDrag.activeKey}
        dragSize={effectsDrag.dragSize}
        fly={effectsDrag.fly}
        overlayRef={effectsDrag.overlayRef}
        flyElRef={effectsDrag.flyElRef}
        flyHost={flyHost}
        overlayHost={overlayHost}
        activeContent={
          effectsDrag.activeKey
            ? effectsDrag.renderOverlay(effectsDrag.activeKey, effectsDrag.overlayNum)
            : null
        }
        classForKey={effectClassForKey}
      />
      <AnimatePresence>{notice && <Toast message={notice} />}</AnimatePresence>
    </>
  );
}
