import { Fragment } from "react";
import type { Block } from "../lib/model";
import type { BandPatch } from "../lib/blocks";
import DragCard from "./DragCard";
import SemanticUnitCard from "./SemanticUnitCard";

interface PresetViewProps {
  blocks: Block[];
  blocksEmpty: boolean;
  selectedIds: string[];
  accentOf: (b: Block) => string;
  activeKey: string | null;
  flyKey: string | null;
  virtualIndexOf: (key: string) => number | null;
  onDragStart: (key: string, x: number, y: number) => void;
  onRemoveBlock: (idx: number) => void;
  onRemoveGroup: (label: string) => void;
  onPatchBand: (blockIdx: number, bandIdx: number, patch: BandPatch) => void;
}

/** 语义视图：每个 block 一张标准卡，单卡拖拽；组内卡只保留组标识 */
export default function PresetView({
  blocks,
  blocksEmpty,
  selectedIds,
  accentOf,
  activeKey,
  flyKey,
  virtualIndexOf,
  onDragStart,
  onRemoveBlock,
  onRemoveGroup,
  onPatchBand,
}: PresetViewProps) {
  return (
    <>
      {blocksEmpty && <div className="hint-row show">从预设栏添加调音</div>}
      <div className="cards device-cards">
        {blocks.map((b, bi) => {
          const elementKey = b.id ?? String(bi);
          const isGroup = !!b.group;
          const active = activeKey === elementKey || flyKey === elementKey;
          return (
            <Fragment key={elementKey}>
              <DragCard
                id={elementKey}
                className={`group-card standalone${active ? " is-dragging" : ""}${isGroup ? " sem-group" : ""}${selectedIds.includes(elementKey) ? " is-selected" : ""}`}
                style={isGroup ? ({ "--card-accent": accentOf(b) } as React.CSSProperties) : undefined}
                onDragStart={onDragStart}
              >
                <SemanticUnitCard
                  block={b}
                  index={bi}
                  groupLabel={isGroup ? b.group : undefined}
                  dragNum={virtualIndexOf(elementKey)}
                  onRemoveBlock={onRemoveBlock}
                  onRemoveGroup={onRemoveGroup}
                  onPatchBand={onPatchBand}
                />
              </DragCard>
            </Fragment>
          );
        })}
      </div>
    </>
  );
}
