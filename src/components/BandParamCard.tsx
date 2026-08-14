import { X } from "lucide-react";
import type { Block } from "../lib/model";
import type { BandPatch } from "../lib/blocks";
import GainSlider from "./GainSlider";

interface BandParamCardProps {
  block: Block;
  index: number;
  dragNum: number | null;
  num?: number;
  onRemoveBlock: (idx: number) => void;
  onPatchBlock: (idx: number, patch: Partial<Block>) => void;
  onPatchBand: (blockIdx: number, bandIdx: number, patch: BandPatch) => void;
}

export default function BandParamCard({
  block: b,
  index: bi,
  dragNum,
  num,
  onRemoveBlock,
  onPatchBlock,
  onPatchBand,
}: BandParamCardProps) {
  const band = b.bands[0] ?? { fc: 1000, gain_db: 0, q: 1 };

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
        <span className="b-type">PEAK</span>
        <span className="grow" />
      </div>
      <div className="fcq-row">
        <div className="fcq-cell">
          <span className="field-label">Fc</span>
          <input type="number" className="num" value={band.fc} onChange={(e) => onPatchBand(bi, 0, { fc: Number(e.target.value) })} />
        </div>
        <div className="fcq-cell">
          <span className="field-label">Q</span>
          <input type="number" step={0.01} className="num" value={band.q} onChange={(e) => onPatchBand(bi, 0, { q: Number(e.target.value) })} />
        </div>
      </div>
      <div className="gain-cell">
        <span className="field-label">Gain</span>
        <div className="gain-line">
          <GainSlider
            min={-30}
            max={30}
            value={band.gain_db}
            disabled={!b.enabled}
            onValueChange={(v) => onPatchBand(bi, 0, { gain_db: v })}
          />
          <input
            type="number"
            className="gain-input"
            min={-30}
            max={30}
            step={0.1}
            value={band.gain_db}
            aria-label="Gain 数值"
            onChange={(e) => onPatchBand(bi, 0, { gain_db: Number(e.target.value) })}
          />
        </div>
      </div>
    </>
  );
}
