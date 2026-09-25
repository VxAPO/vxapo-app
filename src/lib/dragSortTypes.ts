import type { ReactNode } from "react";
import { EASE_OUT_SOFT } from "./motionEase";

/** 稳定性约束：消抖必须长于所有拖拽动画（下界 = LAYOUT_ANIM_MS + ANIM_SETTLE_BUFFER_MS），
    避免动画未结束又触发新一轮布局 */
export const ENTER_DEBOUNCE_MS = 500;
export const LAYOUT_ANIM_MS = 400;
export const LAYOUT_ANIM_OUTSIDE_MS = 320;
/** 避让/占位布局动画曲线：与视图收窄（viewMotion.COLLAPSE_EASE）同一条「先快后慢」，
    单源在 lib/motionEase.ts —— 两处必须一致，改这里等于同时改两处手感 */
export const LAYOUT_EASE = EASE_OUT_SOFT;
/** 松手时若布局动画未结束，多等这段缓冲再落地，避免动画被硬切。注意它与
    LAYOUT_ANIM_MS / LAYOUT_ANIM_OUTSIDE_MS 的配对由 applyLayout 按实际用到的时长记账 */
export const ANIM_SETTLE_BUFFER_MS = 80;
/** 距离所有槽位超过该值才算真正离开卡片区 */
export const OUTSIDE_DIST = 48;
/** 悬浮层夹取时距内容区边界的内缩：不要贴死边缘（阴影与圆角要留出余地） */
export const DRAG_BOUNDS_INSET_PX = 8;
/** 悬浮层贴到内容区上下边缘时的自动滚动速度（px/s）。
    按帧时长换算成步长，所以 60Hz / 120Hz 观感一致，不会随刷新率翻倍。 */
export const EDGE_SCROLL_SPEED_PX_S = 600;
/** 弧线与阴影的总时长（framer-motion 的 duration）：位置段跑完 288ms，余下留给阴影收尾 */
export const FLY_ANIM_MS = 400;
/** 位置段占总时长的比例：位置跑完后的余量留给阴影收尾与「落定」停顿 */
export const FLY_MOVE_RATIO = 0.72;
/** 弧线飞行（位置动画）时长：framer 的 x/y times 由这个比例换算，位置只跑这一段，之后停住并交接 */
export const FLY_MOVE_MS = Math.round(FLY_ANIM_MS * FLY_MOVE_RATIO);
/** 位置到位的无阴影停顿：让「落定」看得见，之后才揭示原卡片 */
export const FLY_HOLD_MS = 100;
/** 副本卸载前的时序缓冲：吸收 framer 收尾与定时器抖动 */
export const FLY_TAIL_MS = 30;
/** 落地动画总时长：0.4s 动画 + 0.1s 无阴影停顿 + 缓冲 */
export const FLY_TOTAL_MS = FLY_ANIM_MS + FLY_HOLD_MS + FLY_TAIL_MS;
/** 位置动画结束到「交接」的余量：等 framer 最后一帧写完再改写样式，避免被它的缓存覆盖 */
export const FLY_HANDOVER_MS = FLY_MOVE_MS + 40;

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
  /** 最近一次指针位置：滚动时没有 pointermove，重算命中要用它 */
  lastX: number;
  lastY: number;
  /** 抓取时活动视图舞台的视口坐标：滚动增量由它相减得到
      （卡片上可能挂着布局动画的 transform，不能直接拿卡片量） */
  scopeLeft: number;
  scopeTop: number;
  /** 原始卡片位置（悬浮层对齐锚点，保证抓取时完全覆盖原卡片） */
  originLeft: number;
  originTop: number;
  /** 被拖卡片尺寸（夹取用） */
  cardW: number;
  cardH: number;
  /** 内容区矩形（`.content` 那个大圆角矩形）：悬浮层被夹在它里面（再内缩
      `DRAG_BOUNDS_INSET_PX`），拖到边界就停住、不再跟着指针往外跑
      （系统光标本身锁不住，能限制的是这张卡片） */
  bounds: { left: number; top: number; right: number; bottom: number };
  /** 悬浮层当前左上角（视口坐标，已夹取）：边缘自动滚动按它判断有没有贴住上下界 */
  curLeft: number;
  curTop: number;
  /** 悬浮层当前中心（视口坐标，已夹取）：**占位命中按它算**，不按真实指针——
      指针可以跑到内容区外（卡片被夹在边上），那时按指针判会误判成「槽位外」、
      占位框跳到末尾，与眼睛看到的卡片位置对不上。 */
  curMidX: number;
  curMidY: number;
  /** 是否已越过移动阈值真正进入拖拽（未越过前不应用占位/阴影，避免点击闪动） */
  armed: boolean;
  html?: string;
}

export interface DragListeners {
  move: (e: PointerEvent) => void;
  up: (e: PointerEvent) => void;
  cancel: (e: PointerEvent) => void;
  /** 拖拽期间页面滚动（捕获阶段挂在 window 上，滚动事件不冒泡）：
      槽位矩形要按滚动增量平移，命中要用最后指针位置重算 */
  scroll: () => void;
}

export interface UseDragSortOptions {
  /** 拖拽槽位范围：只收集带相同 data-dnd-group 的卡片 */
  group: string;
  markDirty: () => void;
  overlayContent: (key: string, num: number) => ReactNode;
  /** 提交重排结果（key 为目标卡片 key，target 为目标虚拟序号） */
  commitOrder: (key: string, target: number) => void;
}
