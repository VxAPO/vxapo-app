import { memo } from "react";
import { X } from "lucide-react";
import type { Block } from "../lib/model";
import { t } from "../lib/i18n/core";
import { BAND_LIMITS, type BandPatch } from "../lib/blocks";
import GainSlider from "./GainSlider";
import NumInput from "./NumInput";

const FC_MIN = BAND_LIMITS.fc.min;
const FC_MAX = BAND_LIMITS.fc.max;
const fcToPos = (fc: number) => {
  const v = Math.min(FC_MAX, Math.max(FC_MIN, fc));
  return Math.log(v / FC_MIN) / Math.log(FC_MAX / FC_MIN);
};
const posToFc = (p: number) => Math.round(FC_MIN * Math.pow(FC_MAX / FC_MIN, p));

interface BandParamCardProps {
  block: Block;
  index: number;
  dragNum: number | null;
  num?: number;
  onRemoveBlock: (idx: number) => void;
  onPatchBlock: (idx: number, patch: Partial<Block>) => void;
  onPatchBand: (blockIdx: number, bandIdx: number, patch: BandPatch) => void;
}

/** 参数视图滤波器卡：中心频率/Q/Gain 均为「标签 + 滑块 + 输入框」 */
function BandParamCard({
  block: b,
  index: bi,
  dragNum,
  num,
  onRemoveBlock,
  onPatchBlock,
  onPatchBand,
}: BandParamCardProps) {
  const band = b.bands[0] ?? { fc: 1000, gain_db: 0, q: 1 };
  const disabled = !b.enabled;
  const typeKey =
    band.kind === "low_shelf"
      ? "filter.type.lowShelf"
      : band.kind === "high_shelf"
        ? "filter.type.highShelf"
        : band.kind === "low_pass"
          ? "filter.type.lowPass"
          : band.kind === "high_pass"
            ? "filter.type.highPass"
            : "filter.type.peaking";

  return (
    <>
      <div className="b-head">
        <button
          className={`enable-dot ${b.enabled ? "on" : ""}`}
          type="button"
          aria-pressed={b.enabled}
          aria-label={b.enabled ? t("disable.filter") : t("enable.filter")}
          title={b.enabled ? t("disable.filter") : t("enable.filter")}
          onClick={() => onPatchBlock(bi, { enabled: !b.enabled })}
        >
          {String(num ?? (dragNum != null ? dragNum + 1 : bi + 1)).padStart(2, "0")}
        </button>
        <span className="b-type">{t(typeKey)}</span>
        <span className="grow" />
        <button className="close-x" type="button" aria-label={t("aria.delete")} onClick={() => onRemoveBlock(bi)}>
          <X size={12} strokeWidth={2.5} />
        </button>
      </div>
      <div className="band-params">
        <div className="band-param-row">
          <span className="band-param-label">{t("frequency")}</span>
          <GainSlider
            min={0}
            max={1}
            step={0.001}
            value={fcToPos(band.fc)}
            disabled={disabled}
            ariaLabel={t("frequency")}
            onValueChange={(p) => onPatchBand(bi, 0, { fc: posToFc(p) })}
          />
          <NumInput
            value={band.fc}
            min={FC_MIN}
            max={FC_MAX}
            ariaLabel={t("frequency")}
            onCommit={(v) => onPatchBand(bi, 0, { fc: v })}
          />
        </div>
        <div className="band-param-row">
          <span className="band-param-label">{t("q.value")}</span>
          <GainSlider
            min={0.1}
            max={12}
            step={0.01}
            value={Math.min(12, Math.max(0.1, band.q))}
            disabled={disabled}
            ariaLabel={t("q.value")}
            onValueChange={(v) => onPatchBand(bi, 0, { q: v })}
          />
          <NumInput
            value={band.q}
            min={BAND_LIMITS.q.min}
            max={BAND_LIMITS.q.max}
            step={0.01}
            ariaLabel={t("q.value")}
            onCommit={(v) => onPatchBand(bi, 0, { q: v })}
          />
        </div>
        <div className="band-param-row">
          <span className="band-param-label">{t("gain")}</span>
          <GainSlider
            min={-30}
            max={30}
            step={0.1}
            value={Math.min(30, Math.max(-30, band.gain_db))}
            disabled={disabled}
            ariaLabel={t("gain")}
            onValueChange={(v) => onPatchBand(bi, 0, { gain_db: v })}
          />
          <NumInput
            value={band.gain_db}
            min={BAND_LIMITS.gain_db.min}
            max={BAND_LIMITS.gain_db.max}
            step={0.1}
            ariaLabel={t("gain")}
            onCommit={(v) => onPatchBand(bi, 0, { gain_db: v })}
          />
        </div>
      </div>
    </>
  );
}

/**
 * 参数卡按实际用到的内容做浅比较：拖动滑块时 setBlocks 会生成新 block 对象，
 * 默认 memo 会让全部 31 张卡一起重渲染；这里只让参数变化的那张卡重渲染。
 */
export default memo(BandParamCard, (prev, next) => {
  if (prev.num !== next.num || prev.dragNum !== next.dragNum) return false;
  const a = prev.block;
  const b = next.block;
  if (a.enabled !== b.enabled || a.bands.length !== b.bands.length) return false;
  const ba = a.bands[0] ?? { fc: 1000, gain_db: 0, q: 1 };
  const bb = b.bands[0] ?? { fc: 1000, gain_db: 0, q: 1 };
  return (
    ba.fc === bb.fc &&
    ba.gain_db === bb.gain_db &&
    ba.q === bb.q &&
    ba.kind === bb.kind
  );
});
