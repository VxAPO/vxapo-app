import { Fragment, memo } from "react";
import type { Block, EffectItem } from "../lib/model";
import type { BandPatch } from "../lib/blocks";
import { channelLabel } from "../lib/channels";
import DragCard from "./DragCard";
import BandParamCard from "./BandParamCard";
import EffectCard from "./EffectCard";

interface AdvancedViewProps {
  blocks: Block[];
  showFilterEmptyHint: boolean;
  showEffectEmptyHint: boolean;
  hintShift: number;
  channelOn: boolean;
  channelNames: string[];
  firstChannel: string;
  activeChannel: string;
  onChannelChange: (ch: string) => void;
  selectedIds: string[];
  effects: EffectItem[];
  onToggleEffect: (type: string) => void;
  onRemoveEffect: (type: string) => void;
  onChangeEffectParam: (type: string, key: string, value: number | string) => void;
  activeKey: string | null;
  flyKey: string | null;
  virtualIndexOf: (key: string) => number | null;
  onDragStart: (key: string, x: number, y: number) => void;
  effectActiveKey: string | null;
  effectFlyKey: string | null;
  effectOnDragStart: (key: string, x: number, y: number) => void;
  onRemoveBlock: (idx: number) => void;
  onPatchBlock: (idx: number, patch: Partial<Block>) => void;
  onPatchBand: (blockIdx: number, bandIdx: number, patch: BandPatch) => void;
}

/** 参数视图：滤波器与效果器分区，通道选择只属于滤波器 */
function AdvancedView({
  blocks,
  showFilterEmptyHint,
  showEffectEmptyHint,
  hintShift,
  channelOn,
  channelNames,
  firstChannel,
  activeChannel,
  onChannelChange,
  selectedIds,
  effects,
  onToggleEffect,
  onRemoveEffect,
  onChangeEffectParam,
  activeKey,
  flyKey,
  virtualIndexOf,
  onDragStart,
  effectActiveKey,
  effectFlyKey,
  effectOnDragStart,
  onRemoveBlock,
  onPatchBlock,
  onPatchBand,
}: AdvancedViewProps) {
  const visible = (b: Block) =>
    channelOn
      ? (b.channel ?? firstChannel) === activeChannel
      : !b.channel || b.channel === firstChannel;
  let chOrdinal = 0;

  return (
    <>
      <div className="tuning-section">
        <div className="section-title">滤波器</div>
        {showFilterEmptyHint && (
          <div
            className="hint-row show"
            style={{ transform: `translateX(${hintShift}px)` }}
          >
            从侧栏添加调音
          </div>
        )}
        {channelOn && (
          <div className="col-head">
            <span className="ch-name">{channelNames.length} 声道</span>
            {channelNames.map((c) => (
              <button
                key={c}
                type="button"
                className={`ch-pill${c === activeChannel ? " active" : ""}`}
                onClick={() => onChannelChange(c)}
              >
                {channelLabel(c)}
              </button>
            ))}
          </div>
        )}
        <div className="cards device-cards">
          {blocks.map((b, bi) => {
            if (!visible(b)) return null;
            chOrdinal += 1;
            return (
              <Fragment key={b.id ?? bi}>
                <DragCard
                  id={b.id ?? String(bi)}
                  className={`band-card${b.enabled ? " enabled" : " disabled"}${activeKey === (b.id ?? String(bi)) || flyKey === (b.id ?? String(bi)) ? " is-dragging" : ""}${selectedIds.includes(b.id ?? String(bi)) ? " is-selected" : ""}`}
                  onDragStart={onDragStart}
                >
                  <BandParamCard
                    block={b}
                    index={bi}
                    num={activeKey == null && flyKey == null ? chOrdinal : undefined}
                    dragNum={virtualIndexOf(b.id ?? String(bi))}
                    onRemoveBlock={onRemoveBlock}
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
        <div className="section-title">效果器</div>
        {showEffectEmptyHint && (
          <div
            className="hint-row show"
            style={{ transform: `translateX(${hintShift}px)` }}
          >
            从侧栏添加调音
          </div>
        )}
        <div className="cards device-cards">
          {effects.map((e) => {
            const effKey = `e-${e.type}`;
            const effActive = effectActiveKey === effKey || effectFlyKey === effKey;
            return (
              <DragCard
                key={effKey}
                id={effKey}
                group="effects"
                className={`effect-card${e.enabled ? " enabled" : " disabled"}${effActive ? " is-dragging" : ""}`}
                onDragStart={effectOnDragStart}
              >
                <EffectCard
                  effect={e}
                  onToggle={onToggleEffect}
                  onRemove={onRemoveEffect}
                  onChangeParam={onChangeEffectParam}
                />
              </DragCard>
            );
          })}
        </div>
      </div>
    </>
  );
}

export default memo(AdvancedView);
