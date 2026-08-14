import { Fragment } from "react";
import type { Block } from "../lib/model";
import type { BandPatch } from "../lib/blocks";
import DragCard from "./DragCard";
import BandParamCard from "./BandParamCard";

interface AdvancedViewProps {
  blocks: Block[];
  channelOn: boolean;
  activeKey: string | null;
  flyKey: string | null;
  virtualIndexOf: (key: string) => number | null;
  onDragStart: (key: string, x: number, y: number) => void;
  onRemoveBlock: (idx: number) => void;
  onPatchBlock: (idx: number, patch: Partial<Block>) => void;
  onPatchBand: (blockIdx: number, bandIdx: number, patch: BandPatch) => void;
}

export default function AdvancedView({
  blocks,
  channelOn,
  activeKey,
  flyKey,
  virtualIndexOf,
  onDragStart,
  onRemoveBlock,
  onPatchBlock,
  onPatchBand,
}: AdvancedViewProps) {
  return (
    <>
      {channelOn && (
        <div className="col-head">
          <span className="ch-name">通道（2）</span>
          <span className="ch-pill active">左声道</span>
          <span className="ch-pill">右声道</span>
          <button className="ch-mgmt" type="button">管理</button>
        </div>
      )}
      <div className="cards device-cards">
        {blocks.map((b, bi) => (
          <Fragment key={b.id ?? bi}>
            <DragCard
              id={b.id ?? String(bi)}
              className={`band-card${b.enabled ? " enabled" : " disabled"}${activeKey === (b.id ?? String(bi)) || flyKey === (b.id ?? String(bi)) ? " is-dragging" : ""}`}
              onDragStart={onDragStart}
            >
              <BandParamCard
                block={b}
                index={bi}
                dragNum={virtualIndexOf(b.id ?? String(bi))}
                onRemoveBlock={onRemoveBlock}
                onPatchBlock={onPatchBlock}
                onPatchBand={onPatchBand}
              />
            </DragCard>
          </Fragment>
        ))}
      </div>
    </>
  );
}
