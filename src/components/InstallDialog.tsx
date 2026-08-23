import { memo } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Headphones, Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  friendlyError,
  installDevice,
  isInstalled,
  onInstallProgress,
  rollbackInstall,
  type InstallProgressEvent,
} from "../lib/api";
import type { Device } from "../lib/model";
import { t } from "../lib/i18n/core";
import OverlayScrollbar from "./OverlayScrollbar";

interface InstallDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  devices: Device[];
  onRefresh: () => Promise<void> | void;
  onInstalled: (name: string) => void;
  onBusyChange?: (busy: boolean) => void;
}

type Phase = "idle" | "installing" | "restarting" | "verifying" | "done" | "failed";

function InstallDialog({
  open,
  onOpenChange,
  devices,
  onRefresh,
  onInstalled,
  onBusyChange,
}: InstallDialogProps) {
  const [installingGuid, setInstallingGuid] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [statusText, setStatusText] = useState("");
  const aliveRef = useRef(true);
  const installListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  // 关闭对话框时重置进度状态。
  useEffect(() => {
    if (!open) {
      setInstallingGuid(null);
      setPhase("idle");
      setStatusText("");
    }
  }, [open]);

  const handleProgress = (ev: InstallProgressEvent) => {
    if (!aliveRef.current) return;
    switch (ev.event) {
      case "install_write":
        setStatusText(t("install.phase.writing", { mode: ev.mode }));
        break;
      case "service":
        setPhase("restarting");
        setStatusText(
          ev.action === "stopping"
            ? t("install.phase.stopping")
            : ev.action === "stopped"
              ? t("install.phase.stopped")
              : ev.action === "starting"
                ? t("install.phase.starting")
                : t("install.phase.running"),
        );
        break;
      case "test":
        setPhase("verifying");
        setStatusText(t("install.phase.verifying"));
        break;
      case "retry":
        setStatusText(t("install.phase.retry", { from: ev.from, to: ev.to }));
        break;
      case "complete":
        if (ev.success) {
          setPhase("done");
          setStatusText(t("install.phase.done", { mode: ev.mode ?? "" }));
        } else {
          setPhase("failed");
          setStatusText(t("install.phase.failed"));
        }
        break;
    }
  };

  const handleInstall = async (d: Device) => {
    setInstallingGuid(d.guid);
    setPhase("installing");
    setStatusText(t("install.phase.installing"));
    onBusyChange?.(true);
    const unlisten = await onInstallProgress(handleProgress);
    try {
      const res = await installDevice(d.guid);
      if (!aliveRef.current) return;
      if (res.success) {
        setPhase("done");
        setStatusText(t("install.phase.done", { mode: res.mode ?? "" }));
        onInstalled(d.name);
      } else {
        setPhase("failed");
        setStatusText(t("install.phase.failed"));
        // 失败兜底：回滚注册表，避免产生"已安装"假设备页。
        await rollbackInstall(d.guid).catch(() => {});
      }
      // done / failed 都刷新列表：失败时 best 配置已写入，设备按已安装态出现。
      await onRefresh();
    } catch (e) {
      if (!aliveRef.current) return;
      setPhase("failed");
      setStatusText(friendlyError(e));
      // CLI 异常/超时退出：注册表可能残留，同样兜底回滚。
      await rollbackInstall(d.guid).catch(() => {});
      await onRefresh();
    } finally {
      onBusyChange?.(false);
      unlisten();
    }
  };

  const busy = installingGuid !== null;
  // 安装进行中（installing/restarting/verifying）禁用关闭，成功/失败后才允许关闭。
  const closeDisabled = phase === "installing" || phase === "restarting" || phase === "verifying";
  const candidates = devices.filter((d) => !isInstalled(d));
  const installingDevice = devices.find((d) => d.guid === installingGuid) ?? null;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="vx-dialog-overlay" />
        <Dialog.Content
          className="vx-dialog-content install-dialog"
          aria-describedby={undefined}
          onInteractOutside={(e) => {
            // 安装进行中只允许通过关闭按钮/完成/重试关闭。
            if (installingGuid) e.preventDefault();
          }}
          onEscapeKeyDown={(e) => {
            if (installingGuid) e.preventDefault();
          }}
        >
          <div className="vx-dialog-head">
            <Dialog.Title className="vx-dialog-title">{t("install.title")}</Dialog.Title>
            <Dialog.Close
              className="vx-dialog-close"
              aria-label={t("close.settings")}
              disabled={closeDisabled}
            >
              <X size={16} />
            </Dialog.Close>
          </div>
          <div className="install-body">
            {installingGuid && installingDevice ? (
              <InstallProgressView
                device={installingDevice}
                phase={phase}
                statusText={statusText}
                onRetry={() => void handleInstall(installingDevice)}
                onDone={() => setInstallingGuid(null)}
              />
            ) : candidates.length === 0 ? (
              <div className="install-empty">
                <Headphones size={22} />
                <p>{t("install.empty")}</p>
              </div>
            ) : (
              <>
                <div className="install-list os-scroll" ref={installListRef}>
                  <OverlayScrollbar targetRef={installListRef} thumbRight={-6} zIndex={65} />
                  {candidates.map((d) => (
                    <div className="install-item" key={d.guid}>
                      <div className="install-item-info">
                        <span className="install-item-name">{d.name}</span>
                        <span className="install-item-sub">
                          {d.kind === "capture"
                            ? t("device.capture")
                            : d.kind === "playback"
                              ? t("device.playback")
                              : t("device.type")}
                          {d.channels ? ` · ${d.channels} ${t("device.channels")}` : ""}
                          {d.sample_rate ? ` · ${d.sample_rate} Hz` : ""}
                        </span>
                      </div>
                      <button
                        className="pill install-btn"
                        type="button"
                        disabled={busy}
                        onClick={() => void handleInstall(d)}
                      >
                        {busy ? (
                          <span className="vx-spinner" aria-hidden="true" />
                        ) : (
                          <Plus size={14} />
                        )}
                        {busy ? t("install.inProgress") : t("install")}
                      </button>
                    </div>
                  ))}
                </div>
                <p className="install-hint">{t("install.hint")}</p>
              </>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function InstallProgressView({
  device,
  phase,
  statusText,
  onRetry,
  onDone,
}: {
  device: Device;
  phase: Phase;
  statusText: string;
  onRetry: () => void;
  onDone: () => void;
}) {
  const running = phase === "installing" || phase === "restarting" || phase === "verifying";
  const barWidth =
    phase === "installing" ? "20%"
    : phase === "restarting" ? "45%"
    : phase === "verifying" ? "70%"
    : "100%";
  const pulse = phase === "installing" || phase === "verifying";

  return (
    <div className="install-progress">
      <div className="install-progress-head">
        <span className="install-item-name">{device.name}</span>
        {running && <span className="vx-spinner" aria-hidden="true" />}
      </div>
      <div className="install-progress-track">
        <div
          className={`install-progress-bar${pulse ? " pulse" : ""}`}
          style={{ width: barWidth }}
        />
      </div>
      <p className="install-progress-text">{statusText}</p>
      {!running && (
        <div className="install-actions">
          {phase === "failed" && (
            <button className="pill danger-btn" type="button" onClick={onRetry}>
              {t("install.phase.retryBtn")}
            </button>
          )}
          <button className="pill" type="button" onClick={onDone}>
            {t("install.phase.doneBtn")}
          </button>
        </div>
      )}
    </div>
  );
}

export default memo(InstallDialog);
