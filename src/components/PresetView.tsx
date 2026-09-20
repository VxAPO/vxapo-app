import { Fragment, memo, useMemo } from "react";
import { t } from "../lib/i18n/core";
import type { Block } from "../lib/model";
import { accentStyle } from "../lib/blocks";
import type { DragApi } from "../lib/drag";
import { visibleEffectsFor } from "../lib/filters";
import { useChannelStore, effectiveChannel } from "../stores/channelStore";
import { useConfigStore } from "../stores/configStore";
import { useChannelNames } from "../hooks/useChannelNames";
import DragCard from "./DragCard";
import EffectSemanticCard from "./EffectSemanticCard";
import SemanticUnitCard from "./SemanticUnitCard";

interface PresetViewProps {
  hintShift: number;
  selectedIds: string[];
  accentOf: (b: Block) => string;
  /** 滤波器/效果器的拖拽 API（useDragSort 返回值子集）。 */
  blocksDrag: DragApi;
  effectsDrag: DragApi;
}

/**
 * 语义视图：滤波器与效果器分区，组内卡只保留组标识。
 *
 * 数据与动作直接订阅 configStore/channelStore（决策 4 阶段 A-2b），
 * 外部只传「视图动画 + 选中态 + 拖拽」这些非配置数据。
 */
function PresetView({ hintShift, selectedIds, accentOf, blocksDrag, effectsDrag }: PresetViewProps) {
  const blocks = useConfigStore((s) => s.blocks);
  const effects = useConfigStore((s) => s.effects);
  const toggleEffect = useConfigStore((s) => s.toggleEffect);
  const removeEffect = useConfigStore((s) => s.removeEffect);
  const patchEffectSemantic = useConfigStore((s) => s.patchEffectSemantic);
  const removeBlock = useConfigStore((s) => s.removeBlock);
  const removeGroup = useConfigStore((s) => s.removeGroup);
  const patchBlock = useConfigStore((s) => s.patchBlock);
  const patchBand = useConfigStore((s) => s.patchBand);
  const channelOn = useChannelStore((s) => s.channelOn);
  const activeChannel = useChannelStore((s) => s.activeChannel);
  const names = useChannelNames();

  const visibleEffects = useMemo(
    () => visibleEffectsFor(effects, channelOn, effectiveChannel(names, activeChannel)),
    [effects, channelOn, names, activeChannel],
  );
  const showFilterEmptyHint = blocks.length === 0;
  const showEffectEmptyHint = visibleEffects.length === 0;

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
            const active = blocksDrag.activeKey === elementKey || blocksDrag.fly?.key === elementKey;
            return (
              <Fragment key={elementKey}>
                <DragCard
                  id={elementKey}
                  className={`group-card standalone${b.enabled ? " enabled" : " disabled"}${active ? " is-dragging" : ""}${isGroup ? " sem-group" : ""}${selectedIds.includes(elementKey) ? " is-selected" : ""}`}
                  style={isGroup ? accentStyle(accentOf(b)) : undefined}
                  onDragStart={blocksDrag.startDrag}
                >
                  <SemanticUnitCard
                    block={b}
                    index={bi}
                    groupLabel={isGroup ? b.group : undefined}
                    dragNum={blocksDrag.virtualIndexOf(elementKey)}
                    onRemoveBlock={removeBlock}
                    onRemoveGroup={removeGroup}
                    onPatchBlock={patchBlock}
                    onPatchBand={patchBand}
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
          {visibleEffects.map((e) => {
            const effKey = `e-${e.id ?? e.type}`;
            const effActive =
              effectsDrag.activeKey === effKey || effectsDrag.fly?.key === effKey;
            return (
              <DragCard
                key={effKey}
                id={effKey}
                group="effects"
                className={`effect-card${e.enabled ? " enabled" : " disabled"}${effActive ? " is-dragging" : ""}`}
                onDragStart={effectsDrag.startDrag}
              >
                <EffectSemanticCard
                  effect={e}
                  onToggle={toggleEffect}
                  onRemove={removeEffect}
                  onStrengthChange={patchEffectSemantic}
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
