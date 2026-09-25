import { AnimatePresence, motion } from "framer-motion";
import type { CSSProperties, RefObject, ReactNode } from "react";
import type { FlyState } from "../lib/dragSortTypes";
import { snapPx } from "../lib/snap";

interface DragLayerProps {
  activeKey: string | null;
  dragSize: { width: number; height: number } | null;
  fly: FlyState | null;
  overlayRef: RefObject<HTMLDivElement | null>;
  activeContent: ReactNode;
  classForKey: (key: string) => string;
  styleForKey?: (key: string) => CSSProperties | undefined;
}

export default function DragLayer({
  activeKey,
  dragSize,
  fly,
  overlayRef,
  activeContent,
  classForKey,
  styleForKey,
}: DragLayerProps) {
  return (
    <>
      {activeKey && (
        <div
          ref={overlayRef}
          className={`drag-fly overlay-fixed ${classForKey(activeKey)}`}
          style={{
            ...(styleForKey?.(activeKey) ?? {}),
            ...(dragSize ? { width: dragSize.width, height: dragSize.height } : {}),
          }}
        >
          {activeContent}
        </div>
      )}
      <AnimatePresence>
        {fly && <FlyPath key={fly.id} fly={fly} classForKey={classForKey} styleForKey={styleForKey} />}
      </AnimatePresence>
    </>
  );
}

/** 松手飞行动画：二次贝塞尔弧线匀速飞行，到位后停顿并淡出阴影，体现悬浮落地 */
function FlyPath({
  fly,
  classForKey,
  styleForKey,
}: {
  fly: FlyState;
  classForKey: (key: string) => string;
  styleForKey?: (key: string) => CSSProperties | undefined;
}) {
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
  /**
   * 位置改用 transform 驱动（x / y），left / top 只作静态基准：
   * - 逐帧改 left/top 属于布局属性，浏览器无法合成，整张卡每帧重排 + 重绘
   *   （含文字重新折行、阴影重画）——卡片多时就是掉帧的来源。
   * - transform 只走合成：栅格内容重用，一帧只剩一次合成。
   * 基准与每帧偏移都取到设备像素栅格上，末帧落在吸附后的落点，
   * 保证合成偏移是整数设备像素——否则副本的文字栅格原点与静止卡片差几个像素。
   */
  const baseLeft = snapPx(fly.from.left);
  const baseTop = snapPx(fly.from.top);
  const xs = pts.map((p) => snapPx(p.left) - baseLeft);
  const ys = pts.map((p) => snapPx(p.top) - baseTop);
  // 末帧精确落在吸附后的落点（不再取“路径点”的最后一项，避免差半个像素）
  xs[xs.length - 1] = snapPx(fly.to.left) - baseLeft;
  ys[ys.length - 1] = snapPx(fly.to.top) - baseTop;
  const moveTimes = pts.map((_, i) => (i / (N - 1)) * 0.72);
  const strong = "0 10px 28px rgba(0, 0, 0, 0.18)";
  // 阴影淡出：只收扩散（模糊/偏移缩到 0），透明度保持不变，
  // 最后是 0 半径的不可见阴影，看起来像“收缩消失”而非“褪色”
  const midShadow = "0 4px 10px rgba(0, 0, 0, 0.18)";
  const none = "0 0 0px rgba(0, 0, 0, 0.18)";
  // 尺寸全程等于原卡尺寸（落点尺寸即原尺寸），静态设定即可：
  // 逐帧写 width/height 会让卡片文字每帧重新折行，是另一处掉帧来源。
  return (
    <motion.div
      className={`drag-fly fly-anim ${classForKey(fly.key)}`}
      style={{
        ...(styleForKey?.(fly.key) ?? {}),
        left: baseLeft,
        top: baseTop,
        width: fly.from.width,
        height: fly.from.height,
        // 提前升为合成层：整段飞行只做合成，不再重排/重绘卡片内容
        willChange: "transform",
      }}
      initial={{ x: 0, y: 0, opacity: 1, boxShadow: strong }}
      animate={{
        x: xs,
        y: ys,
        opacity: 1,
        boxShadow: [strong, strong, midShadow, none],
      }}
      exit={{
        opacity: 0,
        transition: { duration: 0.1, ease: "easeOut" },
      }}
      transition={{
        duration: 0.3,
        x: { duration: 0.3, times: moveTimes, ease: "linear" },
        y: { duration: 0.3, times: moveTimes, ease: "linear" },
        boxShadow: { duration: 0.3, times: [0, 0.8, 0.94, 1], ease: "easeOut" },
      }}
    >
      {fly.content}
    </motion.div>
  );
}
