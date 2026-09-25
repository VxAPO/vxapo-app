/**
 * 切换时卡片的错峰淡入（左上 → 右下）。
 *
 * 用 WAAPI 命令式播，不碰 React 状态、更不重挂载：两套视图常驻 DOM、31 张参数卡刻意不重建
 * （见 `ViewStage` 的注释），重建一次子树的首帧布局尖峰比这段动画本身贵得多。
 *
 * 两个关键点：
 * - `fill: "backwards"`：排在后面的卡片在延迟期间保持第一帧（opacity 0）。少了它，卡片会先
 *   整张出现、再被动画拉回 0 淡入 —— 就是一下可见的闪烁。调用方因此要用 `useLayoutEffect`
 *   （在浏览器绘制前同步播动画），用 `useEffect` 有可能晚一帧。
 * - 动画跑完自动回到正常状态（CSS 的 opacity 1），不需要清理，也不留内联样式。
 */

import { EASE_OUT_SOFT } from "./motionEase";
import {
  STAGGER_FADE_MS,
  STAGGER_MAX_DELAY_MS,
  STAGGER_RISE_PX,
  STAGGER_ROW_TOL_PX,
  STAGGER_STEP_MS,
} from "./viewMotion";

/** 卡片 = 每个网格容器的直接子级（`.device-cards` 是 grid，子级就是卡片本体） */
const STAGGER_SELECTOR = ".device-cards > *";

export function playStaggerIn(root: ParentNode | null | undefined): void {
  if (!root || typeof Element === "undefined") return;
  const cards = Array.from(root.querySelectorAll<HTMLElement>(STAGGER_SELECTOR));
  if (!cards.length) return;
  // 读一遍矩形（批量读只触发一次布局）后按「先上后左」排：行容差内算同一行
  const ordered = cards.map((el) => ({ el, rect: el.getBoundingClientRect() }));
  ordered.sort((a, b) =>
    Math.abs(a.rect.top - b.rect.top) > STAGGER_ROW_TOL_PX
      ? a.rect.top - b.rect.top
      : a.rect.left - b.rect.left,
  );
  ordered.forEach(({ el }, i) => {
    el.animate(
      [
        { opacity: 0, transform: `translateY(${STAGGER_RISE_PX}px)` },
        { opacity: 1, transform: "translateY(0)" },
      ],
      {
        duration: STAGGER_FADE_MS,
        delay: Math.min(i * STAGGER_STEP_MS, STAGGER_MAX_DELAY_MS),
        easing: EASE_OUT_SOFT,
        fill: "backwards",
      },
    );
  });
}
