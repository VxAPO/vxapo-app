import { memo } from "react";
import type { Device } from "../lib/model";
import { t } from "../lib/i18n/core";

interface DevicePropsCardProps {
  device: Device | null;
  peakGain: number;
  totalBands: number;
  channelOn: boolean;
  channelCounts: number[];
  onNormalize: () => void;
}

function DevicePropsCard({
  device: selected,
  peakGain,
  totalBands,
  channelOn,
  channelCounts,
  onNormalize,
}: DevicePropsCardProps) {
  const canNormalize = Math.abs(peakGain) > 0.05;
  return (
    <div className="dev-props-card">
      <div className="dev-props-title">{t("device.properties")}</div>
      <div className="dev-prop"><span>{t("device.name")}</span><b className="dev-name">{selected?.name ?? "—"}</b></div>
      <div className="dev-prop"><span>{t("device.type")}</span><b>{selected?.kind === "capture" ? t("device.capture") : selected?.kind === "playback" ? t("device.playback") : "—"}</b></div>
      <div className="dev-prop"><span>{t("device.channels")}</span><b>{selected?.channels ?? "—"}</b></div>
      <div className="dev-prop"><span>{t("device.sampleRate")}</span><b>{selected?.sample_rate != null ? `${selected.sample_rate} Hz` : "—"}</b></div>
      <div className="dev-prop"><span>{t("device.bitDepth")}</span><b>{selected?.bit_depth != null ? `${selected.bit_depth} bit` : "—"}</b></div>
      <div className="dev-prop"><span>{t("device.volume")}</span><b>{selected?.volume != null ? `${Math.round(selected.volume * 100)}%` : "—"}</b></div>
      <div className="dev-prop">
        <span>{t("peakGain")}</span>
        <span className="dev-prop-right">
          <b>{peakGain > 0 ? "+" : ""}{peakGain.toFixed(1)} dB</b>
          <button
            className="dev-prop-btn"
            type="button"
            disabled={!canNormalize}
            title={canNormalize ? t("normalize.title") : t("normalize.title.disabled")}
            onClick={onNormalize}
          >
            {t("normalize")}
          </button>
        </span>
      </div>
      <div className="dev-prop"><span>{t("bands")}</span><b>{channelOn && channelCounts.length ? channelCounts.join(" | ") : totalBands}</b></div>
    </div>
  );
}

export default memo(DevicePropsCard);
