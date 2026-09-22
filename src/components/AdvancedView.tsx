import { Fragment, memo, useMemo } from "react";
import { t } from "../lib/i18n/core";
import type { Block, EffectItem } from "../lib/model";
import { accentStyle } from "../lib/blocks";
import { channelLabel } from "../lib/channels";
import type { DragApi } from "../lib/drag";
import { visibleEffectsFor } from "../lib/filters";
import { effectiveChannel } from "../stores/channelStore";
import { useConfigStore } from "../stores/configStore";
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
  /** 设备页数据：由 App 经 ViewStage 传入（**不要**改回订阅 store，见下方注释）。 */
  blocks: Block[];
  effects: EffectItem[];
  channelOn: boolean;
  activeChannel: string;
  channelNames: string[];
}

/**
 * 参数视图：滤波器与效果器分区，通道选择只属于滤波器。
 *
 * **数据走 props，动作仍直连 store**：动作是与设备无关的 store 单例；数据若直连 store，
 * 设备页过渡就失效——过渡靠 AnimatePresence mode="wait" 保留**上一轮的旧元素实例**，
 * 它带着旧设备的 props 淡出（拆分前原样）。store 是全局实时的，旧元素一旦订阅它，
 * 淡出途中就会渲染成新设备的内容（连页面高度都一起变），整段过渡就不对了。
 */
function AdvancedView({
  hintShift,
  accentOf,
  onChannelChange,
  selectedIds,
  blocksDrag,
  effectsDrag,
  blocks,
  effects,
  channelOn,
  activeChannel,
  channelNames,
}: AdvancedViewProps) {
  const toggleEffect = useConfigStore((s) => s.toggleEffect);
  const removeEffect = useConfigStore((s) => s.removeEffect);
  const patchEffectParam = useConfigStore((s) => s.patchEffectParam);
  const removeBlock = useConfigStore((s) => s.removeBlock);
  const patchBlock = useConfigStore((s) => s.patchBlock);
  const patchBand = useConfigStore((s) => s.patchBand);

  const firstChannel = channelNames[0] ?? "L";
  const effActiveChannel = effectiveChannel(channelNames, activeChannel);
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
              <span className="ch-name">{channelNames.length} {t("channels")}</span>
              {channelNames.map((c) => (
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
