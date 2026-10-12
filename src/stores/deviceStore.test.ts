// @vitest-environment jsdom
//
// deviceStore 轮询与 stale 同步测试。
//
// 核心不变量：5s 轮询稳态只拉设备列表（单 CLI spawn）；**设备列表内容变化
// （插拔信号）当拍补拉 stale**——list_stale_installs 按活跃端点分类，拔盘必须
// 同步响应，不能等 60s 兜底。store 为模块单例，每用例前复位。
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Device, StaleInstall } from "../lib/model";

// 纯函数（deviceListsEqual/isInstalled/friendlyError）用真实实现，IO 用 mock。
vi.mock("../lib/api", async (orig) => {
  const actual = await orig<typeof import("../lib/api")>();
  return {
    ...actual,
    listDevices: vi.fn(),
    listStaleInstalls: vi.fn(),
    migrateStaleInstall: vi.fn(),
  };
});

import * as api from "../lib/api";
import { useDeviceStore } from "./deviceStore";

function dev(guid: string, name = "Dev"): Device {
  return {
    index: 0,
    name,
    guid,
    device_id: "",
    connection: "",
    installed_version: "1",
    install_mode: "",
    slots: { LFX: null, GFX: null, SFX: null, MFX: null, EFX: null },
    sample_rate: null,
    channels: null,
    bit_depth: null,
    kind: "playback",
    volume: null,
  };
}

function resetStore() {
  useDeviceStore.setState({
    devices: [],
    staleInstalls: [],
    staleBusy: false,
    selectedGuid: null,
    uninstallTarget: null,
    uninstalling: false,
    loading: false,
    errorSink: null,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetStore();
  vi.mocked(api.listStaleInstalls).mockResolvedValue([]);
});

describe("deviceStore.load 轮询与 stale 同步", () => {
  it("稳态轮询只拉设备列表（列表不变不补拉 stale，单 spawn）", async () => {
    vi.mocked(api.listDevices).mockResolvedValue([dev("A")]);
    await useDeviceStore.getState().load(true);
    expect(api.listStaleInstalls).toHaveBeenCalledTimes(1); // 首载拉一次

    await useDeviceStore.getState().load(false);
    await useDeviceStore.getState().load(false);
    expect(api.listDevices).toHaveBeenCalledTimes(3);
    expect(api.listStaleInstalls).toHaveBeenCalledTimes(1); // 稳态不补
    expect(useDeviceStore.getState().devices).toHaveLength(1);
  });

  it("拔盘（列表内容变化）当拍补拉 stale，不等 60s 兜底", async () => {
    vi.mocked(api.listDevices).mockResolvedValue([dev("A")]);
    await useDeviceStore.getState().load(true);
    expect(api.listStaleInstalls).toHaveBeenCalledTimes(1);

    // 拔出活跃端点设备：下一轮5s轮询列表少一台（enumerate 只收活跃端点）
    vi.mocked(api.listDevices).mockResolvedValue([]);
    await useDeviceStore.getState().load(false);
    await vi.waitFor(() => expect(api.listStaleInstalls).toHaveBeenCalledTimes(2));
    expect(useDeviceStore.getState().devices).toHaveLength(0);
    expect(useDeviceStore.getState().selectedGuid).toBeNull();
  });

  it("插盘同理：列表新增也当拍补拉", async () => {
    vi.mocked(api.listDevices).mockResolvedValue([]);
    await useDeviceStore.getState().load(true);
    expect(api.listStaleInstalls).toHaveBeenCalledTimes(1);

    vi.mocked(api.listDevices).mockResolvedValue([dev("B")]);
    await useDeviceStore.getState().load(false);
    await vi.waitFor(() => expect(api.listStaleInstalls).toHaveBeenCalledTimes(2));
  });

  it("补拉失败保留现值（横幅不闪没）", async () => {
    vi.mocked(api.listDevices).mockResolvedValue([dev("A")]);
    await useDeviceStore.getState().load(true);
    const prev = [{ guid: "old" }] as unknown as StaleInstall[];
    useDeviceStore.setState({ staleInstalls: prev });

    vi.mocked(api.listDevices).mockResolvedValue([]);
    vi.mocked(api.listStaleInstalls).mockRejectedValue(new Error("boom"));
    await useDeviceStore.getState().load(false);
    await vi.waitFor(() => expect(api.listStaleInstalls).toHaveBeenCalledTimes(2));
    expect(useDeviceStore.getState().staleInstalls).toBe(prev); // 引用不变 = 未被清空
  });
});
