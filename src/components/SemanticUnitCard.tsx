import { X } from "lucide-react";
import type { Block } from "../lib/model";
import { semanticName, type BandPatch } from "../lib/blocks";
import GainSlider from "./GainSlider";

interface SemanticUnitCardProps {
  block: Block;
  index: number;
  groupLabel?: string;
  dragNum: number | null;
  num?: number;
  onRemoveBlock: (idx: number) => void;
  onRemoveGroup: (label: string) => void;
  onPatchBand: (blockIdx: number, bandIdx: number, patch: BandPatch) => void;
}

/** 语义视图单段卡：滑块收窄靠左，频率输入框与滑块同行靠右；组卡用组标签 X 整组删除 */
export default function SemanticUnitCard({
  block: b,
  index: bi,
  groupLabel,
  dragNum,
  num,
  onRemoveBlock,
  onRemoveGroup,
  onPatchBand,
}: SemanticUnitCardProps) {
  return (
    <>
      {!groupLabel && (
        <button className="close-x" type="button" aria-label="删除" onClick={() => onRemoveBlock(bi)}>
          <X size={12} strokeWidth={2.5} />
        </button>
      )}
      <div className="group-head">
        <span className="ord">
          {String(num ?? (dragNum != null ? dragNum + 1 : bi + 1)).padStart(2, "0")}
        </span>
        <span className="g-name">{semanticName(b)}</span>
        <span className="grow" />
        {groupLabel ? (
          <button
            className="sem-chip"
            type="button"
            title="删除整组"
            onClick={() => onRemoveGroup(groupLabel)}
          >
            <span className="sem-chip-label">{groupLabel}</span>
            <X size={10} strokeWidth={2.5} />
          </button>
        ) : (
          <input
            type="number"
            className="num fc-num"
            value={b.bands[0]?.fc ?? 1000}
            aria-label="频率"
            onChange={(e) => onPatchBand(bi, 0, { fc: Number(e.target.value) })}
          />
        )}
      </div>
      <div className="fader-row semantic">
        <span className="sem-label">弱</span>
        <GainSlider
          min={-6}
          max={6}
          value={b.bands[0]?.gain_db ?? 0}
          onValueChange={(v) => onPatchBand(bi, 0, { gain_db: v })}
        />
        <span className="sem-label">强</span>
      </div>
    </>
  );
}
