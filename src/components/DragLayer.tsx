import { AnimatePresence, motion } from "framer-motion";
import type { RefObject, ReactNode } from "react";
import type { FlyState } from "../hooks/useDragSort";

interface DragLayerProps {
  activeKey: string | null;
  dragSize: { width: number; height: number } | null;
  fly: FlyState | null;
  overlayRef: RefObject<HTMLDivElement | null>;
  activeContent: ReactNode;
  classForKey: (key: string) => string;
}

export default function DragLayer({
  activeKey,
  dragSize,
  fly,
  overlayRef,
  activeContent,
  classForKey,
}: DragLayerProps) {
  return (
    <>
      {activeKey && (
        <div
          ref={overlayRef}
          className={`drag-fly overlay-fixed ${classForKey(activeKey)}`}
          style={dragSize ? { width: dragSize.width, height: dragSize.height } : undefined}
        >
          {activeContent}
        </div>
      )}
      <AnimatePresence>
        {fly && <FlyPath key={fly.id} fly={fly} classForKey={classForKey} />}
      </AnimatePresence>
    </>
  );
}

/** 松手飞行动画：二次贝塞尔弧线匀速飞行，到位后停顿并淡出阴影，体现悬浮落地 */
function FlyPath({ fly, classForKey }: { fly: FlyState; classForKey: (key: string) => string }) {
  // 二次贝塞尔：控制点 = 中点 + 垂直方向的弧高
  const dx = fly.to.left - fly.from.left;
  const dy = fly.to.top - fly.from.top;
  const len = Math.hypot(dx, dy) || 1;
  const arc = Math.min(32, len * 0.25);
  // 弧线起手方向：控制点放在起点正左/正右，保证先水平再竖直——
  // 起点在轴线左侧 → 先向右；右侧 → 先向左；然后才弯向占位框
  const side = fly.from.left + fly.from.width / 2 - (fly.to.left + fly.to.width / 2);
  const dir = side < 0 ? 1 : -1;
  const ctrlLeft = fly.from.left + dir * arc * 0.8;
  const ctrlTop = fly.from.top;
  const N = 16;
  const pts = Array.from({ length: N }, (_, i) => {
    const t = i / (N - 1);
    const inv = 1 - t;
    return {
      left: inv * inv * fly.from.left + 2 * inv * t * ctrlLeft + t * t * fly.to.left,
      top: inv * inv * fly.from.top + 2 * inv * t * ctrlTop + t * t * fly.to.top,
    };
  });
  // 中间帧取整对齐像素网格，让徽标文字渲染与网格卡片一致；最后一帧保持精确落点
  const roundedPts = pts.map((p, i) =>
    i === N - 1 ? p : { left: Math.round(p.left), top: Math.round(p.top) },
  );
  const moveTimes = pts.map((_, i) => (i / (N - 1)) * 0.72);
  const widths = pts.map(
    (_, i) => fly.from.width + (fly.to.width - fly.from.width) * (i / (N - 1)),
  );
  const roundedWidths = widths.map((w, i) => (i === N - 1 ? w : Math.round(w)));
  const heights = pts.map(
    (_, i) => fly.from.height + (fly.to.height - fly.from.height) * (i / (N - 1)),
  );
  const roundedHeights = heights.map((h, i) => (i === N - 1 ? h : Math.round(h)));
  const strong = "0 10px 28px rgba(0, 0, 0, 0.18)";
  // 阴影淡出：只收扩散（模糊/偏移缩到 0），透明度保持不变，
  // 最后是 0 半径的不可见阴影，看起来像“收缩消失”而非“褪色”
  const midShadow = "0 4px 10px rgba(0, 0, 0, 0.18)";
  const none = "0 0 0px rgba(0, 0, 0, 0.18)";
  return (
    <motion.div
      className={`drag-fly fly-anim ${classForKey(fly.key)}`}
      initial={{
        left: fly.from.left,
        top: fly.from.top,
        width: fly.from.width,
        height: fly.from.height,
        opacity: 1,
        boxShadow: strong,
      }}
      animate={{
        left: roundedPts.map((p) => p.left),
        top: roundedPts.map((p) => p.top),
        width: roundedWidths,
        height: roundedHeights,
        opacity: 1,
        boxShadow: [strong, strong, midShadow, none],
      }}
      exit={{
        opacity: 0,
        transition: { duration: 0.1, ease: "easeOut" },
      }}
      transition={{
        duration: 0.3,
        left: { duration: 0.3, times: moveTimes, ease: "linear" },
        top: { duration: 0.3, times: moveTimes, ease: "linear" },
        width: { duration: 0.3, times: moveTimes, ease: "linear" },
        height: { duration: 0.3, times: moveTimes, ease: "linear" },
        boxShadow: { duration: 0.3, times: [0, 0.8, 0.94, 1], ease: "easeOut" },
      }}
    >
      {fly.content}
    </motion.div>
  );
}
