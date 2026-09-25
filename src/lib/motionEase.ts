/**
 * 动效曲线的单一来源。
 *
 * 视图收窄（viewMotion）、滚动条长度变形（collapseEase）与卡片拖拽避让（LAYOUT_EASE）
 * 要的是同一条「先快后慢」曲线：数值散在各文件里迟早漂移，于是统一放这里。
 * 改这里的控制点等于同时改三处的时序手感（见 UI 设计规范 06 动效时长表）。
 */

/** 先快后慢（ease-out 类）：cubic-bezier(0.22, 1, 0.36, 1) */
export const EASE_OUT_SOFT = "cubic-bezier(0.22, 1, 0.36, 1)";

/**
 * 带**轻微过冲**的落位曲线（ease-out-back）：冲过目标约 5%，然后干脆收回。
 * 与 `EASE_OUT_SOFT` 同一族手感——尾形是它那条（`P2.x` 0.36 → 0.3，略陡一点，所以收尾干脆
 * 不拖），只把 `P1.y` 抬起来造出过冲（**过冲量全看它**：1.5 ≈ 5%，1.8 ≈ 12%，再大就是弹跳）。
 * 给「往下展一下再回弹」这类"落到位"的动效用：纯 ease-out 只会减速停下，没有回弹感；
 * 而标准 ease-out-back 的尾形偏软，过冲回得很拖沓。
 */
export const EASE_OUT_BACK = "cubic-bezier(0.2, 1.5, 0.3, 1)";

/** 上面这条曲线的控制点，供 JS 侧求值（两者必须一致） */
export const EASE_OUT_SOFT_P1 = { x: 0.22, y: 1 };
export const EASE_OUT_SOFT_P2 = { x: 0.36, y: 1 };
