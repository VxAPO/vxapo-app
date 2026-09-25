import { AnimatePresence, motion } from "framer-motion";
import { useEffect, type CSSProperties, type RefObject, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { FLY_ANIM_MS, FLY_HANDOVER_MS, FLY_MOVE_RATIO, type FlyState } from "../lib/dragSortTypes";
import { snapPx } from "../lib/snap";

interface DragLayerProps {
  activeKey: string | null;
  dragSize: { width: number; height: number } | null;
  fly: FlyState | null;
  overlayRef: RefObject<HTMLDivElement | null>;
  /** 飞行副本元素 ref：由 useDragSort 持有（交接时命令式撤掉合成层提示） */
  flyElRef: RefObject<HTMLDivElement | null>;
  /** 飞行副本的挂载容器（滚动内容层 `.tuning-scroll`）：副本挂进去才能随内容滚 */
  flyHost: HTMLElement | null;
  activeContent: ReactNode;
  classForKey: (key: string) => string;
  styleForKey?: (key: string) => CSSProperties | undefined;
}

export default function DragLayer({
  activeKey,
  dragSize,
  fly,
  overlayRef,
  flyElRef,
  flyHost,
  activeContent,
  classForKey,
  styleForKey,
}: DragLayerProps) {
  return (
    <>
      {activeKey &&
        flyHost &&
        createPortal(
          // 跟手位移由 useDragSort 的 positionOverlay 写 transform（left/top 固定为 0）：
          // 逐帧写 left/top 会反复触发布局，是拖动掉帧的来源之一。
          //
          // portal 进滚动内容层只为**层级归属**：进了（被标签栏压住的）device-body 层叠上下文，
          // 悬浮层才会和飞行副本一样被设备标签栏挡住、而不是浮在它上面。
          // `position` 仍是 fixed（相对视口），所以「指针不动时悬浮层在视口里也不动」的跟手语义不变。
          <div
            ref={overlayRef}
            className={`drag-fly overlay-fixed ${classForKey(activeKey)}`}
            style={{
              ...(styleForKey?.(activeKey) ?? {}),
              ...(dragSize ? { width: dragSize.width, height: dragSize.height } : {}),
            }}
          >
            {activeContent}
          </div>,
          flyHost,
        )}
      <AnimatePresence>
        {fly && (
          <FlyPath
            key={fly.id}
            fly={fly}
            elRef={flyElRef}
            host={flyHost}
            classForKey={classForKey}
            styleForKey={styleForKey}
          />
        )}
      </AnimatePresence>
    </>
  );
}

/** 松手飞行动画：二次贝塞尔弧线匀速飞行，到位后停顿并淡出阴影，体现悬浮落地 */
function FlyPath({
  fly,
  elRef,
  host,
  classForKey,
  styleForKey,
}: {
  fly: FlyState;
  elRef: RefObject<HTMLDivElement | null>;
  /** 挂载容器（滚动内容层）：非空时 portal 进去，副本因此随内容滚 */
  host: HTMLElement | null;
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
   *
   * **基准放在落点、路径偏移相对落点算，末帧 x/y = 0**：
   * 若反过来（基准在起点、末帧偏移 = 落点差），一旦 framer 在动画结束后用缓存再写一次
   * transform，就会在落点上又叠一次偏移——表现为落点漂移、副本卸载时闪回原位。
   * 末帧为 0 时，重写多少次都是原值。
   * 基准与每帧偏移都吸附到设备像素栅格，合成偏移才是整数设备像素，文字栅格才与静止卡片一致。
   */
  const landedLeft = snapPx(fly.to.left);
  const landedTop = snapPx(fly.to.top);
  const xs = pts.map((p) => snapPx(p.left) - landedLeft);
  const ys = pts.map((p) => snapPx(p.top) - landedTop);
  xs[xs.length - 1] = 0;
  ys[ys.length - 1] = 0;
  // 位置段的 times 只铺到 FLY_MOVE_RATIO：位置先跑完，余下的时长留给阴影收尾与「落定」停顿
  const moveTimes = pts.map((_, i) => (i / (N - 1)) * FLY_MOVE_RATIO);
  /**
   * 位置动画跑完（`FLY_MOVE_MS`）后做一次「交接」：撤掉 `transform` 与 `will-change`，
   * 让副本从合成层回到常规绘制（合成层的文字抗锯齿与栅格分辨率和常规层不同，
   * 整段停在合成层上、落地静止时看着发虚，飞行中则被运动掩盖）。
   *
   * 交接是**幂等**的：元素基准本来就是落点，末帧偏移为 0，所以这里不需要再改坐标——
   * 即便 framer 之后用缓存重写一次 transform，写回的也是 0 偏移。落点漂移的 bug 正是
   * "基准在起点 + 末帧偏移 = 落点差" 造成的。
   */
  useEffect(() => {
    const t = window.setTimeout(() => {
      const el = elRef.current;
      if (!el) return;
      el.style.transform = "none";
      el.style.willChange = "auto";
    }, FLY_HANDOVER_MS);
    return () => window.clearTimeout(t);
  }, []);
  const strong = "0 10px 28px rgba(0, 0, 0, 0.18)";
  // 阴影淡出：只收扩散（模糊/偏移缩到 0），透明度保持不变，
  // 最后是 0 半径的不可见阴影，看起来像“收缩消失”而非“褪色”
  const midShadow = "0 4px 10px rgba(0, 0, 0, 0.18)";
  const none = "0 0 0px rgba(0, 0, 0, 0.18)";
  // 尺寸全程等于原卡尺寸（落点尺寸即原尺寸），静态设定即可：
  // 逐帧写 width/height 会让卡片文字每帧重新折行，是另一处掉帧来源。
  const node = (
    <motion.div
      ref={elRef}
      className={`drag-fly fly-anim ${classForKey(fly.key)}`}
      style={{
        ...(styleForKey?.(fly.key) ?? {}),
        // 基准就是落点：路径偏移相对它算，末帧回到 0（见上方注释）
        // 坐标系是**滚动内容坐标**（.tuning-scroll 的包含块），不是视口坐标：
        // 副本因此随内容一起滚，滚动跟随由浏览器合成线程完成、零延迟
        left: landedLeft,
        top: landedTop,
        width: fly.from.width,
        height: fly.from.height,
        // 飞行段升为合成层：只做合成，不重排/重绘卡片内容（落地后由交接撤掉）
        willChange: "transform",
      }}
      initial={{ x: xs[0], y: ys[0], opacity: 1, boxShadow: strong }}
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
        duration: FLY_ANIM_MS / 1000,
        x: { duration: FLY_ANIM_MS / 1000, times: moveTimes, ease: "linear" },
        y: { duration: FLY_ANIM_MS / 1000, times: moveTimes, ease: "linear" },
        // 阴影从位置段结束的那一刻开始收（times 与 moveTimes 同源），而不是各记一套比例
        boxShadow: {
          duration: FLY_ANIM_MS / 1000,
          times: [0, FLY_MOVE_RATIO, 0.94, 1],
          ease: "easeOut",
        },
      }}
    >
      {fly.content}
    </motion.div>
  );
  // 必须 portal 进滚动内容层：副本在容器内才会被浏览器的滚动一起带走（合成线程，零延迟）。
  // 留在容器外就只能靠 JS 逐帧补偿——补偿天然晚一帧，滚动快时就是肉眼可见的抖。
  // PresenceContext 穿透 portal，AnimatePresence 的退场淡出照常生效。
  // 容器还没就绪（首帧/设备页重建中）就不渲染：以内容坐标画在视口层会错位，宁可这一轮没有副本。
  if (!host) return null;
  return createPortal(node, host);
}
