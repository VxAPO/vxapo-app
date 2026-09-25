/**
 * 切换时卡片的错峰淡入（左上 → 右下）。
 *
 * 出现手感：卡片从上方一点（`STAGGER_DROP_PX`）**往下落位**，靠 `EASE_OUT_BACK` 在落点轻轻
 * 过冲再收回——「往下展一下再回弹」。位移千万别写成正值，那就成了「从下方往上收」。
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

import { EASE_OUT_BACK } from "./motionEase";
import {
  STAGGER_DROP_PX,
  STAGGER_FADE_MS,
  STAGGER_ROW_TOL_PX,
  STAGGER_STEP_MS,
  STAGGER_WINDOW_MS,
} from "./viewMotion";

/** 卡片 = 每个网格容器的直接子级（`.device-cards` 是 grid，子级就是卡片本体） */
const STAGGER_SELECTOR = ".device-cards > *";

export function playStaggerIn(root: ParentNode | null | undefined): void {
  if (!root || typeof Element === "undefined") return;
  const cards = Array.from(root.querySelectorAll<HTMLElement>(STAGGER_SELECTOR));
  if (!cards.length) return;
  // 读一遍矩形（批量读只触发一次布局）后按「先上后左」排
  const ordered = cards.map((el) => ({ el, rect: el.getBoundingClientRect() }));
  ordered.sort((a, b) =>
    Math.abs(a.rect.top - b.rect.top) > STAGGER_ROW_TOL_PX
      ? a.rect.top - b.rect.top
      : a.rect.left - b.rect.left,
  );
  // 按行分桶：已排好序，相邻 top 差超过容差即换行
  const rows: HTMLElement[][] = [];
  let lastTop = Number.NEGATIVE_INFINITY;
  for (const { el, rect } of ordered) {
    if (!rows.length || rect.top - lastTop > STAGGER_ROW_TOL_PX) {
      rows.push([]);
      lastTop = rect.top;
    }
    rows[rows.length - 1].push(el);
  }
  // 行主序权重 → 延迟：行内一张一跳、跨行一次跨一整行，所以「越靠右下越晚」全程单调。
  // 张数多时压缩步长（窗口 / 最大权重），而不是把超窗口的卡片挤到同一时刻。
  const cols = Math.max(1, ...rows.map((row) => row.length));
  const maxWeight = (rows.length - 1) * cols + rows[rows.length - 1].length - 1;
  const unit = maxWeight > 0 ? Math.min(STAGGER_STEP_MS, STAGGER_WINDOW_MS / maxWeight) : 0;
  rows.forEach((rowEls, r) => {
    rowEls.forEach((el, c) => {
      el.animate(
        [
          // 起手在**上方**（负值），往下落位；配 EASE_OUT_BACK 在落点轻轻过冲再收回
          { opacity: 0, transform: `translateY(${-STAGGER_DROP_PX}px)` },
          { opacity: 1, transform: "translateY(0)" },
        ],
        {
          duration: STAGGER_FADE_MS,
          delay: (r * cols + c) * unit,
          easing: EASE_OUT_BACK,
          fill: "backwards",
        },
      );
    });
  });
}
