import { Fragment, memo, useMemo } from "react";
import { t } from "../lib/i18n/core";
import type { Block } from "../lib/model";
import { accentStyle } from "../lib/blocks";
import { channelLabel } from "../lib/channels";
import type { DragApi } from "../lib/drag";
import { visibleEffectsFor } from "../lib/filters";
import { effectiveChannel, useChannelStore } from "../stores/channelStore";
import { useConfigStore } from "../stores/configStore";
import { useChannelNames } from "../hooks/useChannelNames";
import DragCard from "./DragCard";
import BandParamCard from "./BandParamCard";
import EffectCard from "./EffectCard";

interface AdvancedViewProps {
  hintShift: number;
  accentOf: (b: Block) => string;
  /** 切换活动声道（App 侧还要清空选中，故仍由外部传入）。 */
  onChannelChange: (ch: string) => void;
  selectedIds: string[];
  /** 滤波器/效果器的拖拽 API（useDragSort 返回值子集）。 */
  blocksDrag: DragApi;
  effectsDrag: DragApi;
}

/**
 * 参数视图：滤波器与效果器分区，通道选择只属于滤波器。
 *
 * 数据与动作直接订阅 configStore/channelStore（决策 4 阶段 A-2b），
 * 外部只传「视图动画 + 选中态 + 拖拽 + 切声道回调」。
 */
function AdvancedView({
  hintShift,
  accentOf,
  onChannelChange,
  selectedIds,
  blocksDrag,
  effectsDrag,
}: AdvancedViewProps) {
  const blocks = useConfigStore((s) => s.blocks);
  const effects = useConfigStore((s) => s.effects);
  const toggleEffect = useConfigStore((s) => s.toggleEffect);
  const removeEffect = useConfigStore((s) => s.removeEffect);
  const patchEffectParam = useConfigStore((s) => s.patchEffectParam);
  const removeBlock = useConfigStore((s) => s.removeBlock);
  const patchBlock = useConfigStore((s) => s.patchBlock);
  const patchBand = useConfigStore((s) => s.patchBand);
  const channelOn = useChannelStore((s) => s.channelOn);
  const activeChannel = useChannelStore((s) => s.activeChannel);
  const names = useChannelNames();

  const firstChannel = names[0] ?? "L";
  const effActiveChannel = effectiveChannel(names, activeChannel);
  const visibleEffects = useMemo(
    () => visibleEffectsFor(effects, channelOn, effActiveChannel),
    [effects, channelOn, effActiveChannel],
  );
  const showFilterEmptyHint = blocks.length === 0;
  const showEffectEmptyHint = visibleEffects.length === 0;

  const visible = (b: Block) =>
    channelOn
      ? (b.channel ?? firstChannel) === effActiveChannel
      : !b.channel || b.channel === firstChannel;
  let chOrdinal = 0;

  return (
    <>
      <div className="tuning-section">
        <div className="section-head">
          <div className="section-title">{t("filters")}</div>
          {channelOn && (
            <div className="col-head">
              <span className="ch-name">{names.length} {t("channels")}</span>
              {names.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`ch-pill${c === effActiveChannel ? " active" : ""}`}
                  onClick={() => onChannelChange(c)}
                >
                  {channelLabel(c)}
                </button>
              ))}
            </div>
          )}
        </div>
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
            if (!visible(b)) return null;
            chOrdinal += 1;
            const key = b.id ?? String(bi);
            return (
              <Fragment key={key}>
                <DragCard
                  id={key}
                  className={`band-card${b.enabled ? " enabled" : " disabled"}${b.group ? " sem-group" : ""}${blocksDrag.activeKey === key || blocksDrag.fly?.key === key ? " is-dragging" : ""}${selectedIds.includes(key) ? " is-selected" : ""}`}
                  style={b.group ? accentStyle(accentOf(b)) : undefined}
                  onDragStart={blocksDrag.startDrag}
                >
                  <BandParamCard
                    block={b}
                    index={bi}
                    num={blocksDrag.activeKey == null && blocksDrag.fly == null ? chOrdinal : undefined}
                    dragNum={blocksDrag.virtualIndexOf(key)}
                    onRemoveBlock={removeBlock}
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
                <EffectCard
                  effect={e}
                  onToggle={toggleEffect}
                  onRemove={removeEffect}
                  onChangeParam={patchEffectParam}
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
