import type { ReactNode } from "react";

/** 稳定性约束：消抖必须长于所有拖拽动画，避免动画未结束又触发新一轮布局 */
export const ENTER_DEBOUNCE_MS = 500;
export const LAYOUT_ANIM_MS = 400;
export const LAYOUT_ANIM_OUTSIDE_MS = 320;
/** 松手时若布局动画未结束，多等这段缓冲再落地，避免动画被硬切 */
export const ANIM_SETTLE_BUFFER_MS = 80;
/** 距离所有槽位超过该值才算真正离开卡片区 */
export const OUTSIDE_DIST = 48;
/** 落地动画总时长：0.3s 动画 + 0.1s 无阴影停顿 + 缓冲 */
export const FLY_TOTAL_MS = 430;

export interface FlyState {
  id: number;
  key: string;
  content: ReactNode;
  from: { left: number; top: number; width: number; height: number };
  to: { left: number; top: number; width: number; height: number };
}

export interface Slot {
  key: string;
  rect: DOMRect;
}

export interface DragSession {
  key: string;
  slots: Slot[];
  base: Map<string, number>;
  virtual: Map<string, number>;
  entered: number;
  /** 是否曾进入过其他槽位：没离开过原位时，“槽位外=末尾”不应生效 */
  everLeft: boolean;
  /** 抓取点相对卡片左上角的偏移，悬浮层跟随指针但不跳动 */
  offsetX: number;
  offsetY: number;
  /** 抓取点坐标（positionOverlay 对移动增量取整的基准） */
  startX: number;
  startY: number;
  /** 原始卡片位置（悬浮层对齐锚点，保证抓取时完全覆盖原卡片） */
  originLeft: number;
  originTop: number;
  /** 是否已越过移动阈值真正进入拖拽（未越过前不应用占位/阴影，避免点击闪动） */
  armed: boolean;
  html?: string;
}

export interface DragListeners {
  move: (e: PointerEvent) => void;
  up: (e: PointerEvent) => void;
  cancel: (e: PointerEvent) => void;
}

export interface UseDragSortOptions {
  /** 拖拽槽位范围：只收集带相同 data-dnd-group 的卡片 */
  group: string;
  markDirty: () => void;
  overlayContent: (key: string, num: number) => ReactNode;
  /** 提交重排结果（key 为目标卡片 key，target 为目标虚拟序号） */
  commitOrder: (key: string, target: number) => void;
}
