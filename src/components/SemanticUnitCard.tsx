import { X } from "lucide-react";
import type { Block } from "../lib/model";
import { semanticName, type BandPatch, type SortItem } from "../lib/blocks";
import GainSlider from "./GainSlider";

interface SemanticUnitCardProps {
  item: SortItem;
  dragNum: number | null;
  num?: number;
  onRemoveBlock: (idx: number) => void;
  onRemoveGroup: (label: string) => void;
  onPatchBand: (blockIdx: number, bandIdx: number, patch: BandPatch) => void;
}

export default function SemanticUnitCard({
  item,
  dragNum,
  num,
  onRemoveBlock,
  onRemoveGroup,
  onPatchBand,
}: SemanticUnitCardProps) {
  const renderBandCard = (block: Block, idx: number, ord?: string) => (
    <div className="name-card" key={idx}>
      <div className="n-head">
        {ord && <span className="ord sm">{ord}</span>}
        <span className="n-name">{semanticName(block)}</span>
        <input
          type="number"
          className="num fc-num"
          value={block.bands[0]?.fc ?? 1000}
          aria-label="频率"
          onChange={(e) => onPatchBand(idx, 0, { fc: Number(e.target.value) })}
        />
      </div>
      <div className="fader-row semantic">
        <span className="sem-label">弱</span>
        <GainSlider
          min={-6}
          max={6}
          value={block.bands[0]?.gain_db ?? 0}
          onValueChange={(v) => onPatchBand(idx, 0, { gain_db: v })}
        />
        <span className="sem-label">强</span>
      </div>
    </div>
  );

  if (item.kind === "standalone") {
    return (
      <>
        <button className="close-x" type="button" aria-label="删除" onClick={() => onRemoveBlock(item.idx)}>
          <X size={12} strokeWidth={2.5} />
        </button>
        <div className="group-head">
          <span className="ord">
            {String(num ?? (dragNum != null ? dragNum + 1 : item.idx + 1)).padStart(2, "0")}
          </span>
          <span className="g-name">{semanticName(item.block)}</span>
          <span className="grow" />
          <input
            type="number"
            className="num fc-num"
            value={item.block.bands[0]?.fc ?? 1000}
            aria-label="频率"
            onChange={(e) => onPatchBand(item.idx, 0, { fc: Number(e.target.value) })}
          />
        </div>
        <div className="fader-row semantic">
          <span className="sem-label">弱</span>
          <GainSlider
            min={-6}
            max={6}
            value={item.block.bands[0]?.gain_db ?? 0}
            onValueChange={(v) => onPatchBand(item.idx, 0, { gain_db: v })}
          />
          <span className="sem-label">强</span>
        </div>
      </>
    );
  }

  const start = num ?? (dragNum != null ? dragNum + 1 : item.g.items[0].idx + 1);
  const end =
    num != null
      ? num + item.g.items.length - 1
      : dragNum != null
        ? dragNum + item.g.items.length
        : item.g.items[item.g.items.length - 1].idx + 1;

  return (
    <>
      <button
        className="close-x"
        type="button"
        aria-label="删除整组"
        onClick={() => onRemoveGroup(item.g.label)}
      >
        <X size={12} strokeWidth={2.5} />
      </button>
      <div className="group-head">
        <span className="ord">
          {String(start).padStart(2, "0")}
          {end > start ? ` & ${String(end).padStart(2, "0")}` : ""}
        </span>
        <span className="g-name">{item.g.label}</span>
        <span className="grow" />
      </div>
      <div
        className="name-cards"
        style={{ gridTemplateColumns: `repeat(${item.g.items.length}, minmax(0, 1fr))` }}
      >
        {item.g.items.map(({ block, idx }) => renderBandCard(block, idx))}
      </div>
    </>
  );
}
