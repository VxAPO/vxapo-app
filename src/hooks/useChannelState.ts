// VxAPO App — 通道选择状态适配层（决策 4 阶段 A-2b：状态已移入 stores/channelStore）。
//
// 本 hook 只负责把「当前设备 guid」推给 store（触发逐设备记忆的保存/恢复），并按原样
// 暴露派生值。返回值与重构前逐字段一致。
import { useEffect, useMemo } from "react";
import { effectiveChannel, useChannelStore } from "../stores/channelStore";

/** 通道选择状态（逐设备记忆开关与活动声道）。 */
export function useChannelState(selectedGuid: string | null, channelNames: string[]) {
  const channelOn = useChannelStore((s) => s.channelOn);
  const activeChannel = useChannelStore((s) => s.activeChannel);
  const setChannelOn = useChannelStore((s) => s.setChannelOn);
  const setActiveChannel = useChannelStore((s) => s.setActiveChannel);

  // 设备切换：store 内部保存旧设备状态并恢复新设备状态（待处理的定时/异步逻辑本就没有）。
  useEffect(() => {
    useChannelStore.getState().setSelectedGuid(selectedGuid);
  }, [selectedGuid]);

  const effActiveChannel = effectiveChannel(channelNames, activeChannel);
  const firstChannel = channelNames[0] ?? "L";

  return useMemo(
    () => ({
      channelOn,
      setChannelOn,
      activeChannel,
      setActiveChannel,
      effActiveChannel,
      firstChannel,
    }),
    [channelOn, activeChannel, effActiveChannel, firstChannel, setChannelOn, setActiveChannel],
  );
}
