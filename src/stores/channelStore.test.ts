// 逐设备通道记忆：**没有记忆的新设备继承当前值**，不回落成「关 + 左声道」。
// 原因见 channelStore.setSelectedGuid 的注释：`load()` 是异步的，新设备的 configChannelMode 要晚一点
// 才到，而在那之前 blocks 还是上一台的 —— 回落会画出「上一台的链按左声道过滤」（切设备闪左声道坐标轴）。
import { beforeEach, describe, expect, it } from "vitest";
import { effectiveChannel, useChannelStore } from "./channelStore";

const reset = () =>
  useChannelStore.setState({
    channelOn: false,
    activeChannel: "L",
    modeByGuid: {},
    activeByGuid: {},
    prevGuid: null,
  });

describe("channelStore：逐设备记忆", () => {
  beforeEach(reset);

  it("离开设备时保存、回到该设备时恢复", () => {
    useChannelStore.getState().setSelectedGuid("A");
    useChannelStore.getState().setChannelOn(true);
    useChannelStore.getState().setActiveChannel("R");

    useChannelStore.getState().setSelectedGuid("B");
    expect(useChannelStore.getState().channelOn).toBe(true);
    expect(useChannelStore.getState().activeChannel).toBe("R");

    useChannelStore.getState().setSelectedGuid("A");
    expect(useChannelStore.getState().channelOn).toBe(true);
    expect(useChannelStore.getState().activeChannel).toBe("R");
  });

  it("新设备没有记忆时保持当前值，不回落成「关 + 左声道」", () => {
    useChannelStore.getState().setSelectedGuid("A");
    useChannelStore.getState().setChannelOn(true);
    useChannelStore.getState().setActiveChannel("R");

    useChannelStore.getState().setSelectedGuid("NEVER_SEEN");
    expect(useChannelStore.getState().channelOn).toBe(true);
    expect(useChannelStore.getState().activeChannel).toBe("R");
  });

  it("有记忆的设备按记忆恢复（记忆是「关」也照样恢复）", () => {
    useChannelStore.setState({
      channelOn: true,
      activeChannel: "R",
      prevGuid: "A",
      modeByGuid: { B: false },
      activeByGuid: { B: "L" },
    });
    useChannelStore.getState().setSelectedGuid("B");
    expect(useChannelStore.getState().channelOn).toBe(false);
    expect(useChannelStore.getState().activeChannel).toBe("L");
  });

  it("guid 为 null 时关掉通道选择器并回到首声道", () => {
    useChannelStore.setState({ channelOn: true, activeChannel: "R", prevGuid: "A" });
    useChannelStore.getState().setSelectedGuid(null);
    expect(useChannelStore.getState().channelOn).toBe(false);
    expect(useChannelStore.getState().activeChannel).toBe("L");
  });
});

describe("effectiveChannel", () => {
  it("活动声道不在当前声道表里时回落到第一个", () => {
    expect(effectiveChannel(["L", "R"], "C")).toBe("L");
    expect(effectiveChannel(["L", "R"], "R")).toBe("R");
    expect(effectiveChannel([], "L")).toBe("L");
  });
});
