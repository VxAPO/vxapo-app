// VxAPO App — 当前设备的声道表（决策 4 阶段 A-2b：视图自行取用，不再由 App 往下传）。
import { useMemo } from "react";
import { channelNamesFor } from "../lib/channels";
import { useDeviceStore } from "../stores/deviceStore";

export function useChannelNames(): string[] {
  const count = useDeviceStore(
    (s) => s.devices.find((d) => d.guid === s.selectedGuid)?.channels,
  );
  return useMemo(() => channelNamesFor(count), [count]);
}
