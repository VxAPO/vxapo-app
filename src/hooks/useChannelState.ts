import { useEffect, useMemo, useRef, useState } from "react";

/** 通道选择状态（逐设备记忆开关与活动声道）。 */
export function useChannelState(selectedGuid: string | null, channelNames: string[]) {
  const [channelOn, setChannelOn] = useState(false);
  const [activeChannel, setActiveChannel] = useState("L");
  const channelOnRef = useRef(channelOn);
  channelOnRef.current = channelOn;
  const activeChannelRef = useRef(activeChannel);
  activeChannelRef.current = activeChannel;
  const channelModeByGuidRef = useRef<Record<string, boolean>>({});
  const activeChannelByGuidRef = useRef<Record<string, string>>({});
  const prevGuidRef = useRef<string | null>(selectedGuid);

  const effActiveChannel = channelNames.includes(activeChannel)
    ? activeChannel
    : (channelNames[0] ?? "L");
  const firstChannel = channelNames[0] ?? "L";

  // 设备切换时保存旧设备通道状态并恢复新设备通道状态（逐设备记忆）。
  useEffect(() => {
    const prev = prevGuidRef.current;
    if (prev === selectedGuid) return;
    if (prev) {
      channelModeByGuidRef.current[prev] = channelOnRef.current;
      activeChannelByGuidRef.current[prev] = activeChannelRef.current;
    }
    prevGuidRef.current = selectedGuid;
    setChannelOn(selectedGuid ? (channelModeByGuidRef.current[selectedGuid] ?? false) : false);
    setActiveChannel(selectedGuid ? (activeChannelByGuidRef.current[selectedGuid] ?? "L") : "L");
  }, [selectedGuid]);

  return useMemo(
    () => ({
      channelOn,
      setChannelOn,
      activeChannel,
      setActiveChannel,
      effActiveChannel,
      firstChannel,
    }),
    [channelOn, activeChannel, effActiveChannel, firstChannel],
  );
}
