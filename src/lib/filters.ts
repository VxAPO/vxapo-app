// 视图侧的通道过滤（原写在 App.tsx 的 useMemo 里，供两个视图自行取用）。
import type { Block, EffectItem } from "./model";

/** 通道模式下隐藏属于其它声道的滤波器块。 */
export function visibleBlocksFor(
  blocks: Block[],
  channelOn: boolean,
  first: string,
  active: string,
): Block[] {
  if (!channelOn) return blocks;
  return blocks.filter((b) => (b.channel ?? first) === active);
}

/** 通道模式下隐藏属于其它声道的前置增益（preamp 带 channels 时按声道过滤）。 */
export function visibleEffectsFor(
  effects: EffectItem[],
  channelOn: boolean,
  active: string,
): EffectItem[] {
  if (!channelOn) return effects;
  return effects.filter(
    (e) => e.type !== "preamp" || !e.channels?.length || e.channels.includes(active),
  );
}
