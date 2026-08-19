import { memo } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Headphones, Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  friendlyError,
  installDevice,
  isInstalled,
  onInstallProgress,
  type InstallProgressEvent,
} from "../lib/api";
import type { Device } from "../lib/model";
import { t } from "../lib/i18n";

interface InstallDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  devices: Device[];
  onRefresh: () => Promise<void> | void;
  onInstalled: (name: string) => void;
  onBusyChange?: (busy: boolean) => void;
}

type Phase = "idle" | "installing" | "restarting" | "verifying" | "done" | "failed";

interface Attempt {
  mode: string;
  score: number;
  max: number;
}

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
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const aliveRef = useRef(true);

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
      setAttempts([]);
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
        if (ev.pipe) {
          setPhase("verifying");
          setStatusText(t("install.phase.verifying"));
        } else if (typeof ev.score === "number" && ev.mode) {
          const mode = ev.mode;
          const score = ev.score;
          const max = ev.max ?? 33;
          setPhase("verifying");
          setAttempts((prev) => [...prev.filter((a) => a.mode !== mode), { mode, score, max }]);
        }
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
    setAttempts([]);
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
      }
      // done / failed 都刷新列表：失败时 best 配置已写入，设备按已安装态出现。
      await onRefresh();
    } catch (e) {
      if (!aliveRef.current) return;
      setPhase("failed");
      setStatusText(friendlyError(e));
    } finally {
      onBusyChange?.(false);
      unlisten();
    }
  };

  const busy = installingGuid !== null;
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
            <Dialog.Close className="vx-dialog-close" aria-label={t("close.settings")}>
              <X size={16} />
            </Dialog.Close>
          </div>
          <div className="install-body">
            {installingGuid && installingDevice ? (
              <InstallProgressView
                device={installingDevice}
                phase={phase}
                statusText={statusText}
                attempts={attempts}
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
                <div className="install-list">
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
  attempts,
  onRetry,
  onDone,
}: {
  device: Device;
  phase: Phase;
  statusText: string;
  attempts: Attempt[];
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
      {attempts.length > 0 && (
        <div className="install-attempts">
          <div className="install-attempts-title">{t("install.phase.detail")}</div>
          {attempts.map((a) => (
            <div className="install-attempt" key={a.mode}>
              <span>{a.mode}</span>
              <span className="install-attempt-score">
                {a.score}/{a.max}
              </span>
            </div>
          ))}
        </div>
      )}
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
