// VxAPO App — 通道选择状态适配层（决策 4 阶段 A-2b：状态已移入 stores/channelStore）。
//
// 本 hook 只负责把「当前设备 guid」推给 store（触发逐设备记忆的保存/恢复），并按原样
// 暴露派生值。返回值与重构前逐字段一致。
import { useLayoutEffect, useMemo } from "react";
import { effectiveChannel, useChannelStore } from "../stores/channelStore";
import { useConfigStore } from "../stores/configStore";

/** 通道选择状态（逐设备记忆开关与活动声道）。 */
export function useChannelState(selectedGuid: string | null, channelNames: string[]) {
  const channelOn = useChannelStore((s) => s.channelOn);
  const activeChannel = useChannelStore((s) => s.activeChannel);
  const setChannelOn = useChannelStore((s) => s.setChannelOn);
  const setActiveChannel = useChannelStore((s) => s.setActiveChannel);
  // 新设备的配置是否已到位（`load()` 是异步的：切设备后有一小段 store 里还是上一台的 blocks）。
  const loaded = useConfigStore((s) => s.loaded);
  const loadedGuid = useConfigStore((s) => s.loadedGuid);
  const ready = selectedGuid === null || (loaded && loadedGuid === selectedGuid);

  // 设备切换：store 内部保存旧设备状态并恢复新设备状态（待处理的定时/异步逻辑本就没有）。
  // 两个条件缺一不可：
  // ① **等新设备的配置到位**（`ready`）。`load()` 是异步的，切设备后有一小段 store 里还是上一台的
  //    `blocks`；若这时就恢复新设备的通道态，这段窗口等于「新设备的通道态 × 上一台的链」——
  //    从「开了通道选择器（preamp 按声道分成两张基准电平卡）」的设备切到「没开」的设备时，就会先
  //    闪一下「上一台左右声道卡片被并成一份」的视图，再跳到新设备（踩过）。等配置到了再恢复，这段
  //    窗口里通道态与还在屏上的上一台数据是自洽的，整页只在新数据到位那一刻换一次。
  // ② **layout effect**（绘制前）：与配置同一次提交里落地，不会先画一帧错的再回正
  //    （App 里同步 `configChannelMode` 的那条同因，见那里的注释）。
  useLayoutEffect(() => {
    if (!ready) return;
    useChannelStore.getState().setSelectedGuid(selectedGuid);
  }, [selectedGuid, ready]);

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
