import { Fragment, memo, useMemo } from "react";
import { t } from "../lib/i18n/core";
import type { Block, EffectItem } from "../lib/model";
import { accentStyle } from "../lib/blocks";
import { channelLabel } from "../lib/channels";
import type { DragApi } from "../lib/drag";
import { visibleBlockFor, visibleEffectsFor } from "../lib/filters";
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
  /** 切换活动声道（与参数视图头部的声道胶囊同一个入口）。 */
  onChannelChange: (ch: string) => void;
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
  onChannelChange,
}: PresetViewProps) {
  const toggleEffect = useConfigStore((s) => s.toggleEffect);
  const removeEffect = useConfigStore((s) => s.removeEffect);
  const patchEffectSemantic = useConfigStore((s) => s.patchEffectSemantic);
  const removeBlock = useConfigStore((s) => s.removeBlock);
  const removeGroup = useConfigStore((s) => s.removeGroup);
  const patchBlock = useConfigStore((s) => s.patchBlock);
  const patchBand = useConfigStore((s) => s.patchBand);

  const effActive = effectiveChannel(channelNames, activeChannel);
  const firstChannel = channelNames[0] ?? "L";
  const visibleEffects = useMemo(
    () => visibleEffectsFor(effects, channelOn, effActive),
    [effects, channelOn, effActive],
  );
  // 显示哪些块由**共享判据**决定（与参数视图完全一致，见 lib/filters.visibleBlockFor）：通道模式看当前
  // 声道，关闭选择器时回退首声道。**不再是**「非通道模式全部显示」——那样关掉选择器会把别的声道的卡
  // 也画出来（关掉选择器时 store 已把块合并到首声道，这里再按同一判据过一遍，内存与文件不一致的那一瞬
  // 也不会冒出别的声道的卡）。
  // 用 `blocks.map` + `return null` 过滤而不是先 filter 成数组：`bi` 必须是 store 里的**真实下标**，
  // `onPatchBlock` / `onRemoveBlock` / `patchBand` 都按下标寻址，错位会改到别的块。
  const visible = (b: Block) => visibleBlockFor(b, channelOn, firstChannel, effActive);
  const showFilterEmptyHint = !blocks.some(visible);
  const showEffectEmptyHint = visibleEffects.length === 0;

  return (
    <>
      <div className="tuning-section">
        <div className="section-head">
          <div className="section-title">{t("filters")}</div>
          {/* 声道胶囊：与参数视图头部同一套标记与样式（`.col-head` + `.ch-pill`）。
              通道模式下语义视图也按声道过滤内容，所以这里必须给切换入口，不能只靠曲线卡的选择器。 */}
          {channelOn && (
            <div className="col-head">
              <span className="ch-name">
                {channelNames.length} {t("channels")}
              </span>
              {channelNames.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`ch-pill${c === effActive ? " active" : ""}`}
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
