import type { Block, EffectItem } from "./model";
import { buildEvalFreqs, curveMax } from "./curve";

export interface NormalizeUpdate {
  id: string;
  channels?: string[];
  gain_db: number;
}

/**
 * 归一化计算（纯函数）：按声道分组求滤波器峰值，得出需要写入的 preamp 更新。
 * 实际显示的总峰值 = 当前基准电平 + 滤波器峰值；新基准电平只抵消滤波器峰值。
 */
export function planNormalize(
  blocks: Block[],
  effects: EffectItem[],
  channelNames: string[],
  channelOn: boolean,
  fs: number,
): { updates: NormalizeUpdate[]; channeled: boolean } {
  const first = channelNames[0] ?? "L";
  const groups = new Map<string, Block[]>();
  if (channelOn) {
    for (const ch of channelNames) groups.set(ch, []);
    for (const b of blocks) {
      const ch = b.channel ?? first;
      const list = groups.get(ch);
      if (list) list.push(b);
      else groups.set(ch, [b]);
    }
  } else {
    groups.set("all", blocks);
  }

  const updates: NormalizeUpdate[] = [];
  for (const [ch, chBlocks] of groups) {
    const preamp = effects.find(
      (e) =>
        e.type === "preamp" &&
        (channelOn ? e.channels?.includes(ch) : !e.channels?.length),
    );
    const currentPreamp =
      typeof preamp?.params?.gain_db === "number" ? preamp.params.gain_db : 0;
    const freqs = buildEvalFreqs(chBlocks);
    const filterPeak = curveMax(freqs, chBlocks, fs, 0);
    const totalPeak = currentPreamp + filterPeak;
    if (Math.abs(totalPeak) < 0.05) continue;
    updates.push(
      channelOn
        ? { id: `preamp:${ch}`, channels: [ch], gain_db: Math.round(-filterPeak * 10) / 10 }
        : { id: "preamp:all", gain_db: Math.round(-filterPeak * 10) / 10 },
    );
  }
  return { updates, channeled: channelOn };
}
