// @vitest-environment jsdom
//
// configStore 动作测试（任务 12 第二批）。
//
// 覆盖范围：不依赖 Tauri 后端的本地动作 + 经 mock 后端驱动的 load/poll/scheduleSave。
// store 是模块单例，每个用例前用 resetStore() 复位（含四个"ref"对象的引用）。
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Block, Band, EffectItem, PresetLibraryEntry } from "../lib/model";
import { defaultEffectParams } from "../lib/effects";

// 后端 IO 全部经 ../lib/api，mock 掉以免碰 Tauri invoke。
vi.mock("../lib/api", () => ({
  readConfig: vi.fn(),
  readConfigChecked: vi.fn(),
  writeConfig: vi.fn(),
  repairStaleAcl: vi.fn(),
  friendlyError: vi.fn((e: unknown) => `ERR:${String(e)}`),
}));

import * as api from "../lib/api";
import { useConfigStore } from "./configStore";

// ── 工具 ────────────────────────────────────────────────────────────────────

function band(fc: number, gain_db = 0, q = 1): Band {
  return { fc, gain_db, q };
}

function block(over: Partial<Block> = {}): Block {
  return { id: "b1", enabled: true, bands: [band(1000, 3)], ...over };
}

function effect(over: Partial<EffectItem> = {}): EffectItem {
  return { id: "wide:all", type: "wide", enabled: true, params: defaultEffectParams("wide"), ...over };
}

const preset: PresetLibraryEntry = {
  id: "p1",
  group: "低音",
  name: "低频增强",
  desc: "",
  bands: [
    { fc: 60, gain_db: 4, q: 0.8 },
    { fc: 120, gain_db: 2, q: 1.0 },
  ],
};

/** 一份含单个 peq 块的 config.toml 文本。 */
function cfgText(fc: number, enabled = true): string {
  return [
    "version = 1",
    `enabled = ${enabled}`,
    "",
    "[meta]",
    'app = "vxapo"',
    "schema = 1",
    "",
    "[[effects]]",
    'type = "peq"',
    "enabled = true",
    "[[effects.bands]]",
    `fc = ${fc}`,
    "gain_db = 3",
    "q = 1.0",
    "",
  ].join("\n");
}

function resetStore(): void {
  useConfigStore.setState({
    blocks: [],
    effects: [],
    tuningMap: {},
    loaded: false,
    configChannelMode: false,
    pollPaused: false,
    reloadNonce: 0,
    inputs: {
      selectedGuid: null,
      channelCtx: { mode: false, first: "L", active: "L" },
      deviceGuids: [],
    },
    errorSink: null,
    notifySink: null,
    dirtyRef: { current: false },
    tailRef: { current: "" },
    initReq: { current: new Set<string>() },
    aclRepairRef: { current: new Set<string>() },
    configRevisionRef: { current: null },
    saveTimer: { id: undefined },
    loadSeq: 0,
    tuningSeq: 0,
  });
}

/** 设置输入（默认立体声、无设备列表）。 */
function setInputs(over: Partial<{ selectedGuid: string | null; mode: boolean; first: string; active: string; deviceGuids: string[] }> = {}): void {
  const st = useConfigStore.getState();
  const cur = st.inputs;
  st.setInputs({
    selectedGuid: over.selectedGuid !== undefined ? over.selectedGuid : cur.selectedGuid,
    channelCtx: {
      mode: over.mode ?? cur.channelCtx.mode,
      first: over.first ?? cur.channelCtx.first,
      active: over.active ?? cur.channelCtx.active,
    },
    deviceGuids: over.deviceGuids ?? cur.deviceGuids,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetStore();
});

// ── 输入与派生 ──────────────────────────────────────────────────────────────

describe("setInputs（按值比较）", () => {
  it("值相同（新对象/新数组）不触发更新", () => {
    setInputs({ selectedGuid: "A", deviceGuids: ["A", "B"] });
    const before = useConfigStore.getState().inputs;
    setInputs({ selectedGuid: "A", deviceGuids: ["A", "B"] });
    expect(useConfigStore.getState().inputs).toBe(before);
  });

  it("selectedGuid 变化触发更新", () => {
    setInputs({ selectedGuid: "A" });
    setInputs({ selectedGuid: "B" });
    expect(useConfigStore.getState().inputs.selectedGuid).toBe("B");
  });
});

describe("writableBlocks", () => {
  it("非通道模式：只保留未分配声道与第一声道的块", () => {
    useConfigStore.setState({
      blocks: [block({ id: "a", channel: undefined }), block({ id: "b", channel: "L" }), block({ id: "c", channel: "R" })],
      inputs: { selectedGuid: "A", channelCtx: { mode: false, first: "L", active: "L" }, deviceGuids: [] },
    });
    expect(useConfigStore.getState().writableBlocks().map((b) => b.id)).toEqual(["a", "b"]);
  });

  it("通道模式：返回全部块", () => {
    useConfigStore.setState({
      blocks: [block({ id: "a" }), block({ id: "b", channel: "R" })],
      inputs: { selectedGuid: "A", channelCtx: { mode: true, first: "L", active: "R" }, deviceGuids: [] },
    });
    expect(useConfigStore.getState().writableBlocks().map((b) => b.id)).toEqual(["a", "b"]);
  });
});

// ── 加/删块与效果器 ─────────────────────────────────────────────────────────

describe("addBand", () => {
  it("peaking 默认 1000Hz/Q1，且标记 dirty", () => {
    useConfigStore.getState().addBand();
    const b = useConfigStore.getState().blocks[0];
    expect(b.bands[0]).toEqual({ fc: 1000, gain_db: 0, q: 1, kind: "peaking" });
    expect(useConfigStore.getState().dirtyRef.current).toBe(true);
  });

  it("低架默认 200Hz/Q0.707，高通默认 80Hz", () => {
    useConfigStore.getState().addBand("low_shelf");
    useConfigStore.getState().addBand("high_pass");
    expect(useConfigStore.getState().blocks[0].bands[0]).toEqual({ fc: 200, gain_db: 0, q: 0.707, kind: "low_shelf" });
    expect(useConfigStore.getState().blocks[1].bands[0]).toEqual({ fc: 80, gain_db: 0, q: 0.707, kind: "high_pass" });
  });

  it("通道模式下挂到 active 声道（可被 channel 覆盖）", () => {
    setInputs({ selectedGuid: "A", mode: true, first: "L", active: "R" });
    useConfigStore.getState().addBand("peaking");
    useConfigStore.getState().addBand("peaking", "L");
    const [b0, b1] = useConfigStore.getState().blocks;
    expect(b0.channel).toBe("R");
    expect(b1.channel).toBe("L");
  });

  it("达到 31 段上限时提示且不新增", () => {
    const notify = vi.fn();
    useConfigStore.setState({
      blocks: [block({ id: "full", bands: Array.from({ length: 31 }, (_, i) => band(20 + i * 10)) })],
      notifySink: notify,
    });
    useConfigStore.getState().addBand();
    expect(useConfigStore.getState().blocks).toHaveLength(1);
    expect(notify).toHaveBeenCalledTimes(1);
  });
});

describe("addEffect / toggleEffect / patch*", () => {
  it("新增效果器带 driver 默认参数", () => {
    useConfigStore.getState().addEffect("wide");
    expect(useConfigStore.getState().effects[0].params).toEqual(defaultEffectParams("wide"));
    expect(useConfigStore.getState().effects[0].id).toBe("wide:all");
  });

  it("同 id 重复新增不产生第二份", () => {
    useConfigStore.getState().addEffect("wide");
    useConfigStore.getState().addEffect("wide");
    expect(useConfigStore.getState().effects).toHaveLength(1);
  });

  it("通道模式下 preamp 按声道生成", () => {
    setInputs({ selectedGuid: "A", mode: true, active: "R" });
    useConfigStore.getState().addEffect("preamp");
    const e = useConfigStore.getState().effects[0];
    expect(e.id).toBe("preamp:R");
    expect(e.channels).toEqual(["R"]);
  });

  it("toggleEffect 翻转开关，patchEffectParam 写入参数", () => {
    useConfigStore.setState({ effects: [effect()] });
    useConfigStore.getState().toggleEffect("wide:all");
    useConfigStore.getState().patchEffectParam("wide:all", "gain", 0.25);
    const e = useConfigStore.getState().effects[0];
    expect(e.enabled).toBe(false);
    expect(e.params?.gain).toBe(0.25);
  });

  it("patchEffectSemantic 按语义强度重算参数（wide 强度=空气吸收）", () => {
    useConfigStore.setState({ effects: [effect()] });
    useConfigStore.getState().patchEffectSemantic("wide:all", 0.5);
    expect(useConfigStore.getState().effects[0].params?.air).toBe(0.5);
  });

  it("removeEffect 后 effects 里不再有该 id（含未标记 id 的项）", () => {
    useConfigStore.setState({ effects: [effect()], ...{} });
    useConfigStore.getState().removeEffect("wide:all");
    expect(useConfigStore.getState().effects).toHaveLength(0);
  });
});

describe("块编辑", () => {
  it("removeBlock 按下标删除，removeGroup 按组删除", () => {
    useConfigStore.setState({
      blocks: [block({ id: "a", group: "G1" }), block({ id: "b", group: "G1" }), block({ id: "c" })],
    });
    useConfigStore.getState().removeBlock(2);
    expect(useConfigStore.getState().blocks.map((b) => b.id)).toEqual(["a", "b"]);
    useConfigStore.getState().removeGroup("G1");
    expect(useConfigStore.getState().blocks).toHaveLength(0);
  });

  it("patchBlock 合并补丁到指定块", () => {
    useConfigStore.setState({ blocks: [block({ id: "a" }), block({ id: "b" })] });
    useConfigStore.getState().patchBlock(1, { enabled: false, name: "低音" });
    expect(useConfigStore.getState().blocks[1]).toMatchObject({ id: "b", enabled: false, name: "低音" });
  });

  it("patchBand 改 fc 时清掉自定义名字（让语义标签跟随频响）", () => {
    useConfigStore.setState({ blocks: [block({ id: "a", name: "我的低音" })] });
    useConfigStore.getState().patchBand(0, 0, { gain_db: 5 });
    expect(useConfigStore.getState().blocks[0].name).toBe("我的低音");
    useConfigStore.getState().patchBand(0, 0, { fc: 200 });
    const b = useConfigStore.getState().blocks[0];
    expect(b.name).toBeUndefined();
    expect(b.bands[0].fc).toBe(200);
    expect(b.bands[0].gain_db).toBe(5);
  });

  it("ensureIds 只给缺失 id 的块补 id", () => {
    useConfigStore.setState({ blocks: [block({ id: "keep" }), block({ id: undefined })] });
    useConfigStore.getState().ensureIds();
    const [a, b] = useConfigStore.getState().blocks;
    expect(a.id).toBe("keep");
    expect(typeof b.id).toBe("string");
    expect(b.id).not.toBe("");
  });
});

// ── 预设 ────────────────────────────────────────────────────────────────────

describe("applyPreset", () => {
  it("按组追加块并返回组名（重名自动编号）", () => {
    useConfigStore.setState({ blocks: [block({ id: "a", group: "低音" })] });
    const group = useConfigStore.getState().applyPreset(preset);
    expect(group).toBe("低音 2");
    const added = useConfigStore.getState().blocks.slice(1);
    expect(added).toHaveLength(2);
    expect(added[0]).toMatchObject({ group: "低音 2", name: "低频增强", channel: undefined });
    expect(added[0].bands).toEqual([{ fc: 60, gain_db: 4, q: 0.8 }]);
  });

  it("通道模式下挂到 active 声道", () => {
    setInputs({ selectedGuid: "A", mode: true, active: "R" });
    useConfigStore.getState().applyPreset(preset);
    expect(useConfigStore.getState().blocks[0].channel).toBe("R");
  });

  it("超出 31 段上限时提示并放弃", () => {
    const notify = vi.fn();
    useConfigStore.setState({
      blocks: [block({ id: "full", bands: Array.from({ length: 30 }, (_, i) => band(20 + i * 10)) })],
      notifySink: notify,
    });
    const ret = useConfigStore.getState().applyPreset(preset);
    expect(ret).toBeUndefined();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(useConfigStore.getState().blocks).toHaveLength(1);
  });
});

// ── 通道基准电平 ────────────────────────────────────────────────────────────

describe("setChannelPreampMode", () => {
  it("开启通道选择器：全局 preamp 拆成每声道一个（继承 gain 与开关）", () => {
    useConfigStore.setState({
      effects: [{ id: "preamp:all", type: "preamp", enabled: false, params: { gain_db: -3 } }],
    });
    useConfigStore.getState().setChannelPreampMode(false, ["L", "R"]);
    const ids = useConfigStore.getState().effects.map((e) => e.id);
    expect(ids).toEqual(["preamp:L", "preamp:R"]);
    expect(useConfigStore.getState().effects[0]).toMatchObject({
      enabled: false,
      params: { gain_db: -3 },
      channels: ["L"],
    });
  });

  it("关闭通道选择器：按第一声道合并回 preamp:all", () => {
    useConfigStore.setState({
      effects: [
        { id: "preamp:L", type: "preamp", enabled: true, params: { gain_db: -2 }, channels: ["L"] },
        { id: "preamp:R", type: "preamp", enabled: true, params: { gain_db: -8 }, channels: ["R"] },
      ],
    });
    useConfigStore.getState().setChannelPreampMode(true, ["L", "R"]);
    const effects = useConfigStore.getState().effects;
    expect(effects).toHaveLength(1);
    expect(effects[0]).toMatchObject({ id: "preamp:all", params: { gain_db: -2 } });
    expect(effects[0].channels).toBeUndefined();
  });

  it("没有对应 preamp 时不动 effects", () => {
    const before = [effect()];
    useConfigStore.setState({ effects: before });
    useConfigStore.getState().setChannelPreampMode(false, ["L", "R"]);
    expect(useConfigStore.getState().effects).toBe(before);
  });

  it("关闭通道选择器：块也一并合并到首声道（丢非首声道块、抹掉声道标识）", () => {
    useConfigStore.setState({
      blocks: [
        block({ id: "l1", channel: "L" }),
        block({ id: "r1", channel: "R" }),
        block({ id: "free" }),
      ],
      effects: [],
    });
    useConfigStore.getState().setChannelPreampMode(true, ["L", "R"]);
    const blocks = useConfigStore.getState().blocks;
    expect(blocks.map((b) => b.id)).toEqual(["l1", "free"]);
    expect(blocks.every((b) => b.channel === undefined)).toBe(true);
  });

  it("开启通道选择器不动块，且已是单链时关闭也是原引用（无谓重渲染）", () => {
    const merged = [block({ id: "l1" }), block({ id: "free" })];
    useConfigStore.setState({ blocks: merged, effects: [] });
    useConfigStore.getState().setChannelPreampMode(false, ["L", "R"]);
    expect(useConfigStore.getState().blocks).toBe(merged);
    useConfigStore.getState().setChannelPreampMode(true, ["L", "R"]);
    expect(useConfigStore.getState().blocks).toBe(merged);
  });
});

describe("normalizeChainGain", () => {
  it("无峰值（空链）时提示未归一化且不写 preamp", () => {
    const notify = vi.fn();
    useConfigStore.setState({ blocks: [], effects: [], notifySink: notify });
    useConfigStore.getState().normalizeChainGain(48000, ["L"], false);
    expect(useConfigStore.getState().effects).toHaveLength(0);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("有峰值时写入 preamp:all（取负抵消滤波峰值）并提示", () => {
    const notify = vi.fn();
    useConfigStore.setState({ blocks: [block({ id: "a", bands: [band(1000, 6)] })], effects: [], notifySink: notify });
    useConfigStore.getState().normalizeChainGain(48000, ["L"], false);
    const e = useConfigStore.getState().effects[0];
    expect(e.id).toBe("preamp:all");
    expect(e.params?.gain_db).toBeCloseTo(-6, 1);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(useConfigStore.getState().dirtyRef.current).toBe(true);
  });

  it("通道模式：按声道分别写 preamp 并汇总提示", () => {
    const notify = vi.fn();
    useConfigStore.setState({
      blocks: [
        block({ id: "a", channel: "L", bands: [band(1000, 6)] }),
        block({ id: "b", channel: "R", bands: [band(1000, 3)] }),
      ],
      effects: [],
      notifySink: notify,
    });
    useConfigStore.getState().normalizeChainGain(48000, ["L", "R"], true);
    const byId = new Map(useConfigStore.getState().effects.map((e) => [e.id, e]));
    expect([...byId.keys()].sort()).toEqual(["preamp:L", "preamp:R"]);
    expect(byId.get("preamp:L")?.params?.gain_db).toBeCloseTo(-6, 1);
    expect(byId.get("preamp:R")?.params?.gain_db).toBeCloseTo(-3, 1);
    expect(notify.mock.calls[0][0]).toEqual(expect.stringContaining("L"));
  });

  it("纯衰减声道不补偿（峰值取曲线最大值，不为负）", () => {
    useConfigStore.setState({
      blocks: [block({ id: "a", channel: "L", bands: [band(1000, -6)] })],
      effects: [],
    });
    useConfigStore.getState().normalizeChainGain(48000, ["L"], true);
    expect(useConfigStore.getState().effects).toHaveLength(0);
  });
});

// ── 后端交互（mock）────────────────────────────────────────────────────────

describe("load", () => {
  it("成功：解析块/效果器/通道模式，tuningMap 取顶层 enabled", async () => {
    vi.mocked(api.readConfig).mockResolvedValue(cfgText(123, false));
    setInputs({ selectedGuid: "A" });
    await useConfigStore.getState().load();
    const s = useConfigStore.getState();
    expect(s.blocks).toHaveLength(1);
    expect(s.blocks[0].bands[0].fc).toBe(123);
    expect(s.blocks[0].id).toBeTruthy();
    expect(s.loaded).toBe(true);
    expect(s.tuningMap.A).toBe(false);
    expect(s.errorSink).toBeNull();
  });

  it("读取失败：清空块、报错、仍置 loaded", async () => {
    const err = vi.fn();
    vi.mocked(api.readConfig).mockRejectedValue(new Error("boom"));
    useConfigStore.setState({ errorSink: err });
    setInputs({ selectedGuid: "A" });
    await useConfigStore.getState().load();
    const s = useConfigStore.getState();
    expect(s.blocks).toHaveLength(0);
    expect(s.loaded).toBe(true);
    expect(err).toHaveBeenCalledWith("ERR:Error: boom");
  });

  it("未选设备直接返回（不读盘）", async () => {
    await useConfigStore.getState().load();
    expect(api.readConfig).not.toHaveBeenCalled();
    expect(useConfigStore.getState().loaded).toBe(false);
  });

  it("切设备后迟到的旧响应作废（loadSeq 守卫）", async () => {
    let resolveFirst!: (v: string) => void;
    vi.mocked(api.readConfig).mockReturnValueOnce(new Promise<string>((r) => (resolveFirst = r)));
    setInputs({ selectedGuid: "A" });
    const p1 = useConfigStore.getState().load();

    vi.mocked(api.readConfig).mockResolvedValueOnce(cfgText(999));
    setInputs({ selectedGuid: "B" });
    const p2 = useConfigStore.getState().load();
    await p2;
    expect(useConfigStore.getState().blocks[0].bands[0].fc).toBe(999);

    resolveFirst(cfgText(123));
    await p1;
    expect(useConfigStore.getState().blocks[0].bands[0].fc).toBe(999);
  });
});

describe("poll", () => {
  it("dirty 时不查盘（避免覆盖手头改动）", () => {
    setInputs({ selectedGuid: "A" });
    useConfigStore.getState().markDirty();
    useConfigStore.getState().poll();
    expect(api.readConfigChecked).not.toHaveBeenCalled();
  });

  it("内容未变（后端不回传文本）时不改动状态", () => {
    useConfigStore.setState({ blocks: [block({ id: "keep" })] });
    setInputs({ selectedGuid: "A" });
    vi.mocked(api.readConfigChecked).mockResolvedValue({ revision: "r1", text: null });
    useConfigStore.getState().poll();
    expect(useConfigStore.getState().blocks.map((b) => b.id)).toEqual(["keep"]);
  });

  it("内容变化时刷新块与效果器，并沿用相同内容的块 id", async () => {
    useConfigStore.setState({ blocks: [block({ id: "keep", bands: [band(123, 3)] })] });
    setInputs({ selectedGuid: "A" });
    vi.mocked(api.readConfigChecked).mockResolvedValue({ revision: "r1", text: cfgText(123) });
    useConfigStore.getState().poll();
    await vi.waitFor(() => expect(useConfigStore.getState().configRevisionRef.current).toBe("r1"));
    const s = useConfigStore.getState();
    expect(s.blocks).toHaveLength(1);
    expect(s.blocks[0].id).toBe("keep");
    expect(s.blocks[0].bands[0].fc).toBe(123);
  });
});

describe("toggleDeviceTuning", () => {
  it("当前设备只翻转并标 dirty（由自动保存写盘）", () => {
    setInputs({ selectedGuid: "A" });
    useConfigStore.getState().toggleDeviceTuning("A");
    expect(useConfigStore.getState().tuningMap.A).toBe(false);
    expect(useConfigStore.getState().dirtyRef.current).toBe(true);
    expect(api.readConfig).not.toHaveBeenCalled();
  });

  it("非当前设备直接改写目标配置的 enabled", async () => {
    setInputs({ selectedGuid: "A" });
    vi.mocked(api.readConfig).mockResolvedValue(cfgText(123, true));
    vi.mocked(api.writeConfig).mockResolvedValue();
    useConfigStore.getState().toggleDeviceTuning("B");
    await vi.waitFor(() => expect(api.writeConfig).toHaveBeenCalledTimes(1));
    const [guid, content] = vi.mocked(api.writeConfig).mock.calls[0];
    expect(guid).toBe("B");
    expect(content).toEqual(expect.stringContaining("enabled = false"));
  });
});

describe("scheduleSave", () => {
  it("dirty + loaded 时 300ms 后写盘，内容带上 enabled", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(api.writeConfig).mockResolvedValue();
      useConfigStore.setState({ blocks: [block({ id: "a" })], loaded: true, tuningMap: { A: false } });
      setInputs({ selectedGuid: "A" });
      useConfigStore.getState().markDirty();
      useConfigStore.getState().scheduleSave();
      expect(api.writeConfig).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(300);
      expect(api.writeConfig).toHaveBeenCalledTimes(1);
      const [guid, content] = vi.mocked(api.writeConfig).mock.calls[0];
      expect(guid).toBe("A");
      expect(content).toEqual(expect.stringContaining("enabled = false"));
      expect(useConfigStore.getState().dirtyRef.current).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("无脏标记时不写盘", async () => {
    vi.useFakeTimers();
    try {
      useConfigStore.setState({ blocks: [block({ id: "a" })], loaded: true });
      setInputs({ selectedGuid: "A" });
      useConfigStore.getState().scheduleSave();
      await vi.advanceTimersByTimeAsync(500);
      expect(api.writeConfig).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("连续排程只保留最后一次（去抖）", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(api.writeConfig).mockResolvedValue();
      useConfigStore.setState({ blocks: [block({ id: "a" })], loaded: true });
      setInputs({ selectedGuid: "A" });
      useConfigStore.getState().markDirty();
      useConfigStore.getState().scheduleSave();
      await vi.advanceTimersByTimeAsync(200);
      useConfigStore.getState().scheduleSave();
      await vi.advanceTimersByTimeAsync(300);
      expect(api.writeConfig).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancelSave 取消已排程的写入", async () => {
    vi.useFakeTimers();
    try {
      useConfigStore.setState({ blocks: [block({ id: "a" })], loaded: true });
      setInputs({ selectedGuid: "A" });
      useConfigStore.getState().markDirty();
      useConfigStore.getState().scheduleSave();
      useConfigStore.getState().cancelSave();
      await vi.advanceTimersByTimeAsync(500);
      expect(api.writeConfig).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("writeConfigSafe", () => {
  it("权限错误时修一次 ACL 后重试", async () => {
    vi.mocked(api.writeConfig)
      .mockRejectedValueOnce(new Error("os error 5"))
      .mockResolvedValueOnce();
    vi.mocked(api.repairStaleAcl).mockResolvedValue();
    await useConfigStore.getState().writeConfigSafe("A", "x");
    expect(api.repairStaleAcl).toHaveBeenCalledWith("A");
    expect(api.writeConfig).toHaveBeenCalledTimes(2);
  });

  it("同一设备只修一次 ACL（第二次仍失败则抛出）", async () => {
    vi.mocked(api.writeConfig).mockRejectedValue(new Error("Access is denied"));
    vi.mocked(api.repairStaleAcl).mockResolvedValue();
    await expect(useConfigStore.getState().writeConfigSafe("A", "x")).rejects.toThrow();
    expect(api.repairStaleAcl).toHaveBeenCalledTimes(1);
    await expect(useConfigStore.getState().writeConfigSafe("A", "x")).rejects.toThrow();
    expect(api.repairStaleAcl).toHaveBeenCalledTimes(1);
  });
});
