import { Fragment } from "react";
import type { BandPatch, SortItem } from "../lib/blocks";
import DragCard from "./DragCard";
import SemanticUnitCard from "./SemanticUnitCard";

interface PresetViewProps {
  items: SortItem[];
  blocksEmpty: boolean;
  activeKey: string | null;
  flyKey: string | null;
  virtualIndexOf: (key: string) => number | null;
  onDragStart: (key: string, x: number, y: number) => void;
  onRemoveBlock: (idx: number) => void;
  onRemoveGroup: (label: string) => void;
  onPatchBand: (blockIdx: number, bandIdx: number, patch: BandPatch) => void;
}

export default function PresetView({
  items,
  blocksEmpty,
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
        {items.map((item) => (
          <Fragment key={item.key}>
            <DragCard
              id={item.key}
              className={`${item.kind === "standalone" ? "group-card standalone" : "group-card"}${activeKey === item.key || flyKey === item.key ? " is-dragging" : ""}`}
              style={item.kind === "group" ? { gridColumn: `span ${item.g.items.length}` } : undefined}
              onDragStart={onDragStart}
            >
              <SemanticUnitCard
                item={item}
                dragNum={virtualIndexOf(item.key)}
                onRemoveBlock={onRemoveBlock}
                onRemoveGroup={onRemoveGroup}
                onPatchBand={onPatchBand}
              />
            </DragCard>
          </Fragment>
        ))}
      </div>
    </>
  );
}
