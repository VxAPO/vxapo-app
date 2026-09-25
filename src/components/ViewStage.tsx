// 视图舞台：语义视图 / 参数视图两套常驻 DOM 的滑动切换（从 App.tsx 抽出）。
import { motion } from "framer-motion";
import type { Block, EffectItem, ViewMode } from "../lib/model";
import type { DragApi } from "../lib/drag";
import { COLLAPSE_EASE, VIEW_SLIDE_MS } from "../lib/viewMotion";
import AdvancedView from "./AdvancedView";
import PresetView from "./PresetView";

interface ViewStageProps {
  view: ViewMode;
  /** 两套视图是否都已预热（预热后非当前视图也保留 DOM）。 */
  stageWarm: boolean;
  /** 正在收窄退场的视图。 */
  hiddenStage: ViewMode | null;
  viewTransitionH: number | null;
  viewCollapsing: boolean;
  viewCollapseMs: number;
  hintShift: number;
  selectedIds: string[];
  accentOf: (b: Block) => string;
  blocksDrag: DragApi;
  effectsDrag: DragApi;
  /** 设备页数据：透传给两套视图。不在这里订阅 store——设备页过渡要靠旧元素实例保留
      旧数据淡出（详见 PresetView / AdvancedView 的注释）。 */
  blocks: Block[];
  effects: EffectItem[];
  channelOn: boolean;
  activeChannel: string;
  channelNames: string[];
  onChannelChange: (ch: string) => void;
  onStageAnimationComplete: (v: ViewMode) => void;
}

/**
 * 两套视图常驻 DOM：非当前视图 display:none。切换只做动画与显隐，
 * 不再重建 31 张卡的 DOM（反复切换的挂载/首帧布局尖峰因此消失）。
 * 退场那套先用 is-exiting（绝对定位让出文档流）演完，再收成 is-hidden。
 */
export default function ViewStage({
  view,
  stageWarm,
  hiddenStage,
  viewTransitionH,
  viewCollapsing,
  viewCollapseMs,
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
  onStageAnimationComplete,
}: ViewStageProps) {
  return (
    <div
      className="view-stack"
      style={{
        minHeight: viewTransitionH ?? undefined,
        // 先快后慢：起步就带走大部分距离，尾巴只做收敛——慢起曲线在高度差
        // 小时前段几乎不动，看起来像平移完了先停一下
        transition: viewCollapsing ? `min-height ${viewCollapseMs}ms ${COLLAPSE_EASE}` : "none",
      }}
    >
      {(["preset", "advanced"] as const).map((v) => {
        const active = view === v;
        const hidden = hiddenStage === v;
        if (!active && !stageWarm) return null;
        return (
          <motion.div
            key={v}
            data-view={v}
            className={`view-stage${active ? " is-active" : hidden ? " is-hidden" : " is-exiting"}`}
            initial={false}
            animate={
              active ? { x: 0, opacity: 1 } : { x: v === "preset" ? "-100%" : "100%", opacity: 0 }
            }
            onAnimationComplete={() => onStageAnimationComplete(v)}
            transition={
              active
                ? // 进场只做 x 平移，opacity 立即到 1：淡入交给卡片错峰（playStaggerIn）。
                  // 整体再淡一层会和卡片自己的淡入相乘，卡片永远亮不满、观感发灰。
                  { duration: VIEW_SLIDE_MS / 1000, ease: "easeInOut", opacity: { duration: 0 } }
                : { duration: VIEW_SLIDE_MS / 1000, ease: "easeInOut" }
            }
          >
            {v === "preset" ? (
              <PresetView
                hintShift={hintShift}
                selectedIds={selectedIds}
                accentOf={accentOf}
                blocksDrag={blocksDrag}
                effectsDrag={effectsDrag}
                blocks={blocks}
                effects={effects}
                channelOn={channelOn}
                activeChannel={activeChannel}
                channelNames={channelNames}
              />
            ) : (
              <AdvancedView
                hintShift={hintShift}
                accentOf={accentOf}
                onChannelChange={onChannelChange}
                selectedIds={selectedIds}
                blocksDrag={blocksDrag}
                effectsDrag={effectsDrag}
                blocks={blocks}
                effects={effects}
                channelOn={channelOn}
                activeChannel={activeChannel}
                channelNames={channelNames}
              />
            )}
          </motion.div>
        );
      })}
    </div>
  );
}
