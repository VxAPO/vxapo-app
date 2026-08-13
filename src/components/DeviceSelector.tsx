import { useEffect, useRef, useState } from "react";
import { ChevronDown, CircleCheck, Download, Mic, Volume2 } from "lucide-react";
import type { Device, Flow } from "../types";

interface DeviceSelectorProps {
  flow: Flow;
  onFlowChange: (f: Flow) => void;
  devices: Device[];
  selectedId: string;
  onSelect: (id: string) => void;
  onInstall: () => void;
  tuningEnabled: boolean;
  onTuningChange: (v: boolean) => void;
}

export default function DeviceSelector({
  flow,
  onFlowChange,
  devices,
  selectedId,
  onSelect,
  onInstall,
  tuningEnabled,
  onTuningChange,
}: DeviceSelectorProps) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const current = devices.find((d) => d.id === selectedId);
  const list = devices.filter((d) => d.flow === flow);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (anchorRef.current && !anchorRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div className="device-area">
      <div
        className="flow-switch"
        data-flow={flow}
        onClick={() => onFlowChange(flow === "playback" ? "capture" : "playback")}
        role="switch"
        aria-checked={flow === "playback"}
      >
        <div className="knob" />
        <span className={`flow-opt ${flow === "playback" ? "active" : ""}`}>
          <Volume2 size={14} />
          播放
        </span>
        <span className={`flow-opt ${flow === "capture" ? "active" : ""}`}>
          <Mic size={14} />
          捕获
        </span>
      </div>

      <div className="device-anchor" ref={anchorRef}>
        <button className="device-btn btn-press" onClick={() => setOpen((v) => !v)}>
          {flow === "playback" ? <Volume2 size={14} /> : <Mic size={14} />}
          <span className="dev-label">{current?.name ?? "选择设备"}</span>
          <ChevronDown size={14} className="chevron" />
        </button>
        {open && (
          <div className="device-menu">
            {list.map((d) => (
              <div
                key={d.id}
                className={`device-item ${d.id === selectedId ? "selected" : ""} ${d.installed ? "" : "disabled"}`}
                onClick={() => {
                  if (d.installed) {
                    onSelect(d.id);
                    setOpen(false);
                  }
                }}
              >
                <span className="dev-icon">{d.icon}</span>
                <span className="dev-name">{d.name}</span>
                <span className="dev-state">{d.installed ? "已安装" : "未安装"}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <button className="square-btn tooltip btn-press" data-tip={current?.installed ? "已安装" : "安装"} onClick={onInstall}>
        {current?.installed ? <CircleCheck size={16} /> : <Download size={16} />}
      </button>

      <div
        className="toggle"
        data-on={tuningEnabled}
        onClick={() => onTuningChange(!tuningEnabled)}
        role="switch"
        aria-checked={tuningEnabled}
        title="调音开关"
      >
        <div className="thumb" />
      </div>
    </div>
  );
}
