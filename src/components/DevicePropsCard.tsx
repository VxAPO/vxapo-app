import { memo } from "react";
import type { Device } from "../lib/model";

interface DevicePropsCardProps {
  device: Device | null;
  peakGain: number;
  totalBands: number;
  channelOn: boolean;
  channelCounts: number[];
}

function DevicePropsCard({
  device: selected,
  peakGain,
  totalBands,
  channelOn,
  channelCounts,
}: DevicePropsCardProps) {
  return (
    <div className="dev-props-card">
      <div className="dev-props-title">设备属性</div>
      <div className="dev-prop"><span>设备名</span><b className="dev-name">{selected?.name ?? "—"}</b></div>
      <div className="dev-prop"><span>类型</span><b>{selected?.kind === "capture" ? "捕获设备" : selected?.kind === "playback" ? "播放设备" : "—"}</b></div>
      <div className="dev-prop"><span>通道数</span><b>{selected?.channels ?? "—"}</b></div>
      <div className="dev-prop"><span>采样率</span><b>{selected?.sample_rate != null ? `${selected.sample_rate} Hz` : "—"}</b></div>
      <div className="dev-prop"><span>位深</span><b>{selected?.bit_depth != null ? `${selected.bit_depth} bit` : "—"}</b></div>
      <div className="dev-prop"><span>音量</span><b>{selected?.volume != null ? `${Math.round(selected.volume * 100)}%` : "—"}</b></div>
      <div className="dev-prop"><span>峰值增益</span><b>{peakGain > 0 ? "+" : ""}{peakGain.toFixed(1)} dB</b></div>
      <div className="dev-prop"><span>段数</span><b>{channelOn && channelCounts.length ? channelCounts.join(" | ") : totalBands}</b></div>
    </div>
  );
}

export default memo(DevicePropsCard);
