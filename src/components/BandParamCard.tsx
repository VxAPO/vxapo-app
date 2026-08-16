import { memo } from "react";
import { X } from "lucide-react";
import type { Block } from "../lib/model";
import type { BandPatch } from "../lib/blocks";
import GainSlider from "./GainSlider";

const FC_MIN = 20;
const FC_MAX = 20000;
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

  return (
    <>
      <button className="close-x" type="button" aria-label="删除" onClick={() => onRemoveBlock(bi)}>
        <X size={12} strokeWidth={2.5} />
      </button>
      <div className="b-head">
        <button
          className={`enable-dot ${b.enabled ? "on" : ""}`}
          type="button"
          aria-pressed={b.enabled}
          aria-label={b.enabled ? "停用该段" : "启用该段"}
          title={b.enabled ? "点击停用该段" : "点击启用该段"}
          onClick={() => onPatchBlock(bi, { enabled: !b.enabled })}
        >
          {String(num ?? (dragNum != null ? dragNum + 1 : bi + 1)).padStart(2, "0")}
        </button>
        <span className="b-type">{band.kind === "low_shelf" ? "LS" : band.kind === "high_shelf" ? "HS" : band.kind === "low_pass" ? "LP" : band.kind === "high_pass" ? "HP" : "PEAK"}</span>
        <span className="grow" />
      </div>
      <div className="band-params">
        <div className="band-param-row">
          <span className="band-param-label">中心频率</span>
          <GainSlider
            min={0}
            max={1}
            step={0.001}
            value={fcToPos(band.fc)}
            disabled={disabled}
            ariaLabel="中心频率"
            onValueChange={(p) => onPatchBand(bi, 0, { fc: posToFc(p) })}
          />
          <input
            type="number"
            className="gain-input"
            min={FC_MIN}
            max={FC_MAX}
            value={band.fc}
            aria-label="中心频率数值"
            onChange={(e) => onPatchBand(bi, 0, { fc: Number(e.target.value) })}
          />
        </div>
        <div className="band-param-row">
          <span className="band-param-label">Q 值</span>
          <GainSlider
            min={0.1}
            max={12}
            step={0.01}
            value={Math.min(12, Math.max(0.1, band.q))}
            disabled={disabled}
            ariaLabel="Q 值"
            onValueChange={(v) => onPatchBand(bi, 0, { q: v })}
          />
          <input
            type="number"
            className="gain-input"
            min={0.1}
            max={12}
            step={0.01}
            value={band.q}
            aria-label="Q 值数值"
            onChange={(e) => onPatchBand(bi, 0, { q: Number(e.target.value) })}
          />
        </div>
        <div className="band-param-row">
          <span className="band-param-label">增益</span>
          <GainSlider
            min={-30}
            max={30}
            step={0.1}
            value={Math.min(30, Math.max(-30, band.gain_db))}
            disabled={disabled}
            ariaLabel="增益"
            onValueChange={(v) => onPatchBand(bi, 0, { gain_db: v })}
          />
          <input
            type="number"
            className="gain-input"
            min={-30}
            max={30}
            step={0.1}
            value={band.gain_db}
            aria-label="增益数值"
            onChange={(e) => onPatchBand(bi, 0, { gain_db: Number(e.target.value) })}
          />
        </div>
      </div>
    </>
  );
}

export default memo(BandParamCard);
