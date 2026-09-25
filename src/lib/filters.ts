// 视图侧的通道过滤（原写在 App.tsx 的 useMemo 里，供两个视图与曲线共用**同一条**判据）。
import type { Block, EffectItem } from "./model";

/**
 * 单个块在当前通道模式下是否可见 / 是否参与曲线计算。
 *
 * - 通道模式开：只看当前声道，无声道标识的块归首声道（`(b.channel ?? first) === active`）；
 * - 通道模式关：**回退到首声道**——只留无声道标识或首声道的块，其它声道的块既不显示也不参与计算。
 *
 * 关闭选择器时 `setChannelPreampMode` 会把块真合并到首声道（与 `buildToml` 在 `mode=false` 时的
 * 落盘口径一致），正常情况下这里过滤不掉任何东西；保留同一条判据是为了让「内存与文件不一致的那一瞬」
 * （导入、切设备、外部改写 config.toml）也有确定结果，而不是把各声道的块叠成一条在真实链路里
 * 并不存在的响应（踩过：关闭选择器后曲线先画出一条叠加曲线、下一档才回正）。
 */
export function visibleBlockFor(
  b: Block,
  channelOn: boolean,
  first: string,
  active: string,
): boolean {
  return channelOn ? (b.channel ?? first) === active : !b.channel || b.channel === first;
}

/** 通道过滤后的块列表（判据见 visibleBlockFor）。 */
export function visibleBlocksFor(
  blocks: Block[],
  channelOn: boolean,
  first: string,
  active: string,
): Block[] {
  return blocks.filter((b) => visibleBlockFor(b, channelOn, first, active));
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
