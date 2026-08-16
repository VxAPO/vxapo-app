import { Fragment, memo } from "react";
import { t } from "../lib/i18n";
import type { Block, EffectItem } from "../lib/model";
import { accentStyle, type BandPatch } from "../lib/blocks";
import DragCard from "./DragCard";
import EffectSemanticCard from "./EffectSemanticCard";
import SemanticUnitCard from "./SemanticUnitCard";

interface PresetViewProps {
  blocks: Block[];
  showFilterEmptyHint: boolean;
  showEffectEmptyHint: boolean;
  hintShift: number;
  selectedIds: string[];
  accentOf: (b: Block) => string;
  effects: EffectItem[];
  onToggleEffect: (type: string) => void;
  onRemoveEffect: (type: string) => void;
  onChangeEffectStrength: (type: string, strength: number) => void;
  activeKey: string | null;
  flyKey: string | null;
  virtualIndexOf: (key: string) => number | null;
  onDragStart: (key: string, x: number, y: number) => void;
  effectActiveKey: string | null;
  effectFlyKey: string | null;
  effectOnDragStart: (key: string, x: number, y: number) => void;
  onRemoveBlock: (idx: number) => void;
  onRemoveGroup: (label: string) => void;
  onPatchBlock: (idx: number, patch: Partial<Block>) => void;
  onPatchBand: (blockIdx: number, bandIdx: number, patch: BandPatch) => void;
}

/** 语义视图：滤波器与效果器分区，组内卡只保留组标识 */
function PresetView({
  blocks,
  showFilterEmptyHint,
  showEffectEmptyHint,
  hintShift,
  selectedIds,
  accentOf,
  effects,
  onToggleEffect,
  onRemoveEffect,
  onChangeEffectStrength,
  activeKey,
  flyKey,
  virtualIndexOf,
  onDragStart,
  effectActiveKey,
  effectFlyKey,
  effectOnDragStart,
  onRemoveBlock,
  onRemoveGroup,
  onPatchBlock,
  onPatchBand,
}: PresetViewProps) {
  return (
    <>
      <div className="tuning-section">
        <div className="section-title">{t("filters")}</div>
        {showFilterEmptyHint && (
          <div
            className="hint-row show"
            style={{ transform: `translateX(${hintShift}px)` }}
          >
            {t("add.tuning")}
          </div>
        )}
        <div className="cards device-cards">
          {blocks.map((b, bi) => {
            const elementKey = b.id ?? String(bi);
            const isGroup = !!b.group;
            const active = activeKey === elementKey || flyKey === elementKey;
            return (
              <Fragment key={elementKey}>
                <DragCard
                  id={elementKey}
                  className={`group-card standalone${b.enabled ? " enabled" : " disabled"}${active ? " is-dragging" : ""}${isGroup ? " sem-group" : ""}${selectedIds.includes(elementKey) ? " is-selected" : ""}`}
                  style={isGroup ? accentStyle(accentOf(b)) : undefined}
                  onDragStart={onDragStart}
                >
                  <SemanticUnitCard
                    block={b}
                    index={bi}
                    groupLabel={isGroup ? b.group : undefined}
                    dragNum={virtualIndexOf(elementKey)}
                    onRemoveBlock={onRemoveBlock}
                    onRemoveGroup={onRemoveGroup}
                    onPatchBlock={onPatchBlock}
                    onPatchBand={onPatchBand}
                  />
                </DragCard>
              </Fragment>
            );
          })}
        </div>
      </div>
      <div className="tuning-section">
        <div className="section-title">{t("effects")}</div>
        {showEffectEmptyHint && (
          <div
            className="hint-row show"
            style={{ transform: `translateX(${hintShift}px)` }}
          >
            {t("add.tuning")}
          </div>
        )}
        <div className="cards device-cards">
          {effects.map((e) => {
            const effKey = `e-${e.id ?? e.type}`;
            const effActive = effectActiveKey === effKey || effectFlyKey === effKey;
            return (
              <DragCard
                key={effKey}
                id={effKey}
                group="effects"
                className={`effect-card${e.enabled ? " enabled" : " disabled"}${effActive ? " is-dragging" : ""}`}
                onDragStart={effectOnDragStart}
              >
                <EffectSemanticCard
                  effect={e}
                  onToggle={onToggleEffect}
                  onRemove={onRemoveEffect}
                  onStrengthChange={onChangeEffectStrength}
                />
              </DragCard>
            );
          })}
        </div>
      </div>
    </>
  );
}

export default memo(PresetView);
