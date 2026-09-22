import { Fragment, memo, useMemo } from "react";
import { t } from "../lib/i18n/core";
import type { Block, EffectItem } from "../lib/model";
import { accentStyle } from "../lib/blocks";
import type { DragApi } from "../lib/drag";
import { visibleEffectsFor } from "../lib/filters";
import { effectiveChannel } from "../stores/channelStore";
import { useConfigStore } from "../stores/configStore";
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
  /** 设备页数据：由 App 经 ViewStage 传入（**不要**改回订阅 store，见下方注释）。 */
  blocks: Block[];
  effects: EffectItem[];
  channelOn: boolean;
  activeChannel: string;
  channelNames: string[];
}

/**
 * 语义视图：滤波器与效果器分区，组内卡只保留组标识。
 *
 * **数据走 props，动作仍直连 store**：动作是与设备无关的 store 单例；而数据若直连
 * store，设备页过渡就失效——过渡靠 AnimatePresence mode="wait" 保留**上一轮的旧元素
 * 实例**，它带着旧设备的 props 淡出（拆分前原样）。store 是全局实时的，旧元素一旦
 * 订阅它，淡出途中就会渲染成新设备的内容（连页面高度都一起变），整段过渡就不对了。
 */
function PresetView({
  hintShift,
  selectedIds,
  accentOf,
  blocksDrag,
  effectsDrag,
  blocks,
  effects,
  channelOn,
  activeChannel,
  channelNames,
}: PresetViewProps) {
  const toggleEffect = useConfigStore((s) => s.toggleEffect);
  const removeEffect = useConfigStore((s) => s.removeEffect);
  const patchEffectSemantic = useConfigStore((s) => s.patchEffectSemantic);
  const removeBlock = useConfigStore((s) => s.removeBlock);
  const removeGroup = useConfigStore((s) => s.removeGroup);
  const patchBlock = useConfigStore((s) => s.patchBlock);
  const patchBand = useConfigStore((s) => s.patchBand);

  const visibleEffects = useMemo(
    () => visibleEffectsFor(effects, channelOn, effectiveChannel(channelNames, activeChannel)),
    [effects, channelOn, channelNames, activeChannel],
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
