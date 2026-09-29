/**
 * 动效曲线的单一来源。
 *
 * 视图收窄（viewMotion）、滚动条长度变形（collapseEase）与卡片拖拽避让（LAYOUT_EASE）
 * 要的是同一条「先快后慢」曲线：数值散在各文件里迟早漂移，于是统一放这里。
 * 改这里的控制点等于同时改三处的时序手感（见 UI 设计规范 06 动效时长表）。
 */

/** 先快后慢（ease-out 类）：cubic-bezier(0.22, 1, 0.36, 1) */
export const EASE_OUT_SOFT = "cubic-bezier(0.22, 1, 0.36, 1)";

// 这里曾有一条 EASE_OUT_BACK = cubic-bezier(0.2, 1.5, 0.3, 1)（过冲约 5%），给卡片错峰的"落位"
// 用。错峰改成纯淡入后它没有使用者了，一并撤掉：那点过冲在大卡片上读起来像抖一下（见 staggerIn.ts）。

/** 上面这条曲线的控制点，供 JS 侧求值（两者必须一致） */
export const EASE_OUT_SOFT_P1 = { x: 0.22, y: 1 };
export const EASE_OUT_SOFT_P2 = { x: 0.36, y: 1 };
