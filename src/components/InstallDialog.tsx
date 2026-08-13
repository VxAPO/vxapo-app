import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { InstallStep } from "../types";

interface InstallDialogProps {
  open: boolean;
  deviceName: string;
  onClose: () => void;
}

const STEP_LABELS = [
  "注册 SFX/MFX/EFX 槽位",
  "写入 APO CLSID",
  "备份原槽位值",
  "创建配置目录",
  "写入默认 config.txt",
];

export default function InstallDialog({ open, deviceName, onClose }: InstallDialogProps) {
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<InstallStep[]>(() =>
    STEP_LABELS.map((label) => ({ label, state: "pending" as const })),
  );

  useEffect(() => {
    if (!open) {
      setRunning(false);
      setSteps(STEP_LABELS.map((label) => ({ label, state: "pending" as const })));
      return;
    }
  }, [open]);

  useEffect(() => {
    if (!open || !running) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = (i: number) => {
      if (cancelled) return;
      setSteps((prev) => prev.map((s, idx) => (idx === i ? { ...s, state: "running" } : s)));
      timer = setTimeout(() => {
        if (cancelled) return;
        setSteps((prev) => prev.map((s, idx) => (idx === i ? { ...s, state: "done" } : s)));
        if (i + 1 < STEP_LABELS.length) {
          run(i + 1);
        } else {
          timer = setTimeout(() => {
            if (!cancelled) onClose();
          }, 1000);
        }
      }, 300);
    };
    run(0);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [open, running, onClose]);

  if (!open) return null;

  return (
    <div className="modal-overlay">
      <div className="modal">
        <button className="modal-close" onClick={onClose} aria-label="关闭">
          <X size={16} />
        </button>
        <h2>安装确认</h2>
        <p className="modal-desc">
          确认安装后将执行以下操作（{deviceName}）：
        </p>
        {steps.map((s) => (
          <div key={s.label} className={`install-step ${s.state === "done" ? "done" : ""} ${s.state === "error" ? "error" : ""}`}>
            <span className="dot" />
            {s.label}
          </div>
        ))}
        <div className="modal-actions">
          <button className="btn btn-outline" onClick={onClose}>
            取消
          </button>
          <button className="btn btn-solid" disabled={running} onClick={() => setRunning(true)}>
            确认安装
          </button>
        </div>
      </div>
    </div>
  );
}
