// VxAPO App — 通道选择状态（决策 4 阶段 A-2b）。
//
// 原 useChannelState 的逻辑搬入：逐设备记忆通道开关与活动声道。声道表不进 store——
// 视图用 useChannelNames() 自行从设备取，store 只持有与设备无关的选择状态。
import { create } from "zustand";

/** 当前生效声道：活动声道不在当前声道表里就回落到第一个。 */
export function effectiveChannel(names: string[], active: string): string {
  return names.includes(active) ? active : (names[0] ?? "L");
}

interface ChannelStore {
  channelOn: boolean;
  activeChannel: string;
  /** 逐设备记忆（键为设备 guid）。 */
  modeByGuid: Record<string, boolean>;
  activeByGuid: Record<string, string>;
  prevGuid: string | null;

  /** 设备切换：保存旧设备状态并恢复新设备状态（逐设备记忆）。 */
  setSelectedGuid(guid: string | null): void;
  setChannelOn(on: boolean | ((prev: boolean) => boolean)): void;
  setActiveChannel(ch: string | ((prev: string) => string)): void;
}

export const useChannelStore = create<ChannelStore>((set, get) => ({
  channelOn: false,
  activeChannel: "L",
  modeByGuid: {},
  activeByGuid: {},
  prevGuid: null,

  setSelectedGuid(guid) {
    const { prevGuid, channelOn, activeChannel } = get();
    if (prevGuid === guid) return;
    if (prevGuid) {
      set((s) => ({
        modeByGuid: { ...s.modeByGuid, [prevGuid]: channelOn },
        activeByGuid: { ...s.activeByGuid, [prevGuid]: activeChannel },
      }));
    }
    // 新设备**没有记忆**时保持当前值，不要回落成「关 + 左声道」：`load()` 是异步的，新设备的
    // `configChannelMode` 要晚一点才到，而在那之前 `blocks` 还是上一台的——回落会画出「上一台的链
    // 按左声道过滤」，观感就是切设备时闪一下左声道的坐标轴（踩过）。磁盘值随后在绘制前校正
    // （App 里同步 `configChannelMode` 的那条 useLayoutEffect）。
    set((s) => ({
      prevGuid: guid,
      channelOn: guid ? (s.modeByGuid[guid] ?? channelOn) : false,
      activeChannel: guid ? (s.activeByGuid[guid] ?? activeChannel) : "L",
    }));
  },

  setChannelOn(on) {
    set((s) => ({ channelOn: typeof on === "function" ? on(s.channelOn) : on }));
  },

  setActiveChannel(ch) {
    set((s) => ({ activeChannel: typeof ch === "function" ? ch(s.activeChannel) : ch }));
  },
}));
