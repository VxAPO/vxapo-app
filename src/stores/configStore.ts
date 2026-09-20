// VxAPO App — 配置状态机（决策 4 阶段 A-2）。
//
// 原 useConfig 的状态与动作**逐字**搬入；三处需要 React 生命周期的触发
// （切设备后加载、300ms 去抖保存、2s 轮询、可见性暂停）仍由 hook 驱动本 store。
// 输入（selectedGuid / channelCtx / deviceGuids）由 hook 每次渲染后按值推入。
import { create } from "zustand";
import {
  friendlyError,
  readConfig,
  readConfigChecked,
  repairStaleAcl,
  writeConfig,
} from "../lib/api";
import type { Block, EffectItem, PeqBandKind, PresetLibraryEntry } from "../lib/model";
import { buildToml, parseConfigWithTail, type ChannelCtx } from "../lib/toml";
import { applySemanticStrength, defaultEffectParams, effectsEqual } from "../lib/effects";
import {
  blocksEqualShape,
  ensureBlockIds,
  mergeBlockIds,
  nextGroupName,
  type BandPatch,
} from "../lib/blocks";
import { getLang, t } from "../lib/i18n/core";
import { planNormalize } from "../lib/normalize";

function effectId(e: EffectItem): string {
  return e.id ?? `${e.type}:${e.channels?.length ? e.channels.join(",") : "all"}`;
}

function normalizeEffects(list: EffectItem[]): EffectItem[] {
  return list.map((e) => ({
    ...e,
    id: effectId(e),
    params: { ...defaultEffectParams(e.type), ...(e.params ?? {}) },
  }));
}

const DEFAULT_CHANNEL_CTX: ChannelCtx = { mode: false, first: "L", active: "L" };

interface ConfigInputs {
  selectedGuid: string | null;
  channelCtx: ChannelCtx;
  deviceGuids: string[];
}

interface ConfigStore {
  blocks: Block[];
  effects: EffectItem[];
  tuningMap: Record<string, boolean>;
  loaded: boolean;
  /** 磁盘 config 编码的通道模式：存在任意带 channels 的 EQ 块或效果器即为开启。 */
  configChannelMode: boolean;
  /** 窗口不可见（最小化/遮挡）时轮询暂停。 */
  pollPaused: boolean;
  /** 强制重读计数（导入到当前设备等场景）。 */
  reloadNonce: number;

  inputs: ConfigInputs;
  errorSink: ((msg: string) => void) | null;
  notifySink: ((msg: string) => void) | null;

  // 非响应式可变引用（原 useRef 一一对应）
  dirtyRef: { current: boolean };
  tailRef: { current: string };
  initReq: { current: Set<string> };
  aclRepairRef: { current: Set<string> };
  configRevisionRef: { current: string | null };
  saveTimer: { id: number | undefined };
  /** 请求序号：切设备/重载时作废旧请求（等价原 effect 的 alive 标记）。 */
  loadSeq: number;
  tuningSeq: number;

  setErrorSink(sink: ((msg: string) => void) | null): void;
  setNotifySink(sink: ((msg: string) => void) | null): void;
  /** 按值比较后写入输入（对象/数组每次渲染都是新引用，避免无谓更新）。 */
  setInputs(next: ConfigInputs): void;
  setPollPaused(paused: boolean): void;

  load(): Promise<void>;
  poll(): void;
  scheduleSave(): void;
  cancelSave(): void;
  ensureIds(): void;
  initDeviceTuning(): void;
  forceReload(): void;
  markDirty(): void;
  writeConfigSafe(guid: string, content: string): Promise<void>;

  applyPreset(p: PresetLibraryEntry): string | undefined;
  addBand(kind?: PeqBandKind, channel?: string): void;
  addEffect(type: string): void;
  removeEffect(id: string): void;
  toggleEffect(id: string): void;
  patchEffectParam(id: string, key: string, value: number | string): void;
  patchEffectSemantic(id: string, strength: number): void;
  removeBlock(idx: number): void;
  removeGroup(label: string): void;
  patchBlock(idx: number, patch: Partial<Block>): void;
  patchBand(blockIdx: number, bandIdx: number, patch: BandPatch): void;
  deviceTuningOn(guid: string): boolean;
  toggleDeviceTuning(guid: string): void;
  /**
   * 开关通道选择器：全局基准电平 ↔ 每声道一个（原 App 内联逻辑）。
   *
   * `on` 传**切换前**的通道模式状态（沿用原实现：`!on` 时把全局 preamp 拆成每声道一个）。
   */
  setChannelPreampMode(on: boolean, channelNames: string[]): void;
  /** 归一化整链增益（planNormalize → 写 preamp 效果器 + 提示）。 */
  normalizeChainGain(fs: number, channelNames: string[], channelOn: boolean): void;
  /** 适配层用它算 totalBands / channelBandCounts（与原 useMemo 同源）。 */
  writableBlocks(): Block[];
}

export const useConfigStore = create<ConfigStore>((set, get) => ({
  blocks: [],
  effects: [],
  tuningMap: {},
  loaded: false,
  configChannelMode: false,
  pollPaused: false,
  reloadNonce: 0,

  inputs: { selectedGuid: null, channelCtx: DEFAULT_CHANNEL_CTX, deviceGuids: [] },
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

  setErrorSink(sink) {
    set({ errorSink: sink });
  },

  setNotifySink(sink) {
    set({ notifySink: sink });
  },

  setInputs(next) {
    const cur = get().inputs;
    const sameCtx =
      cur.channelCtx.mode === next.channelCtx.mode &&
      cur.channelCtx.first === next.channelCtx.first &&
      cur.channelCtx.active === next.channelCtx.active;
    const sameGuids =
      cur.deviceGuids.length === next.deviceGuids.length &&
      cur.deviceGuids.every((g, i) => g === next.deviceGuids[i]);
    if (cur.selectedGuid === next.selectedGuid && sameCtx && sameGuids) return;
    set({ inputs: next });
  },

  setPollPaused(paused) {
    if (get().pollPaused !== paused) set({ pollPaused: paused });
  },

  // 旧 GUID 迁移由提权 CLI 完成，config.toml 可能继承管理员 ACL；
  // 首次写入遇到权限错误时提权修一次 ACL，再重试原写入。
  async writeConfigSafe(guid, content) {
    const { aclRepairRef } = get();
    try {
      await writeConfig(guid, content);
      return;
    } catch (e: unknown) {
      const msg = String(e);
      const denied = /os error 5|access is denied|拒绝访问|permission/i.test(msg);
      if (denied && !aclRepairRef.current.has(guid)) {
        aclRepairRef.current.add(guid);
        await repairStaleAcl(guid);
        await writeConfig(guid, content);
        return;
      }
      throw e;
    }
  },

  async load() {
    const guid = get().inputs.selectedGuid;
    if (!guid) return;
    const seq = get().loadSeq + 1;
    set({ loadSeq: seq, loaded: false });
    get().configRevisionRef.current = null;
    try {
      const text = await readConfig(guid);
      if (get().loadSeq !== seq) return;
      try {
        const parsed = parseConfigWithTail(text);
        set({
          blocks: ensureBlockIds(parsed.blocks),
          effects: normalizeEffects(parsed.effects),
          configChannelMode: parsed.channelMode,
        });
        get().tailRef.current = parsed.tail;
        set((s) => ({
          tuningMap:
            s.tuningMap[guid] === parsed.enabled
              ? s.tuningMap
              : { ...s.tuningMap, [guid]: parsed.enabled },
        }));
      } catch {
        set({ blocks: [], configChannelMode: false });
        get().tailRef.current = "";
      }
      get().errorSink?.("");
      set({ loaded: true });
    } catch (e: unknown) {
      if (get().loadSeq !== seq) return;
      set({ blocks: [], configChannelMode: false });
      get().tailRef.current = "";
      get().errorSink?.(friendlyError(e));
      set({ loaded: true });
    }
  },

  // 监控 config 目录热更新：外部/驱动改写 config.toml 时自动刷新 UI（编辑中跳过，避免覆盖手头改动）
  poll() {
    const { inputs, dirtyRef, configRevisionRef } = get();
    const guid = inputs.selectedGuid;
    if (!guid || dirtyRef.current) return;
    const first = inputs.channelCtx.first;
    readConfigChecked(guid, configRevisionRef.current)
      .then((res) => {
        if (!res) return;
        configRevisionRef.current = res.revision;
        // 内容未变：后端已短路，不回传文本，前端也无需解析
        if (res.text == null || dirtyRef.current) return;
        const parsed = parseConfigWithTail(res.text);
        get().tailRef.current = parsed.tail;
        set({ configChannelMode: parsed.channelMode });
        set((s) => ({
          tuningMap:
            s.tuningMap[guid] === parsed.enabled
              ? s.tuningMap
              : { ...s.tuningMap, [guid]: parsed.enabled },
        }));
        set((s) => {
          const next = normalizeEffects(parsed.effects);
          return { effects: effectsEqual(s.effects, next) ? s.effects : next };
        });
        set((s) => {
          const next = parsed.blocks;
          if (
            s.blocks.length === next.length &&
            s.blocks.every((b, i) => blocksEqualShape(b, next[i], first))
          ) {
            return { blocks: s.blocks };
          }
          return { blocks: mergeBlockIds(s.blocks, next, first) };
        });
      })
      .catch(() => {});
  },

  // 自动保存（300ms 去抖，原子写由 Rust 侧负责）
  scheduleSave() {
    const { inputs, loaded, dirtyRef, saveTimer } = get();
    const guid = inputs.selectedGuid;
    if (!guid || !loaded || !dirtyRef.current) return;
    window.clearTimeout(saveTimer.id);
    saveTimer.id = window.setTimeout(() => {
      const s = get();
      if (!s.inputs.selectedGuid || !s.dirtyRef.current) return;
      const effective = s.tuningMap[guid] ?? true;
      const content = buildToml(s.blocks, effective, s.effects, s.inputs.channelCtx) + s.tailRef.current;
      void s
        .writeConfigSafe(guid, content)
        .then(() => {
          get().dirtyRef.current = false;
        })
        .catch((e: unknown) => get().errorSink?.(friendlyError(e)));
    }, 300);
  },

  cancelSave() {
    const { saveTimer } = get();
    window.clearTimeout(saveTimer.id);
    saveTimer.id = undefined;
  },

  // 兜底：任何 blocks 变化后给缺失稳定 id 的块补 id（拖拽依赖稳定键）
  ensureIds() {
    const prev = get().blocks;
    if (prev.every((b) => b.id)) return;
    set({ blocks: ensureBlockIds(prev) });
  },

  // 设备列表加载后：为每个未缓存的设备读取启用状态，
  // 保证标签页调音开关初次打开就显示正确（不再默认“开”）。
  initDeviceTuning() {
    const { inputs, initReq } = get();
    if (inputs.deviceGuids.length === 0) return;
    const seq = get().tuningSeq + 1;
    set({ tuningSeq: seq });
    for (const guid of inputs.deviceGuids) {
      if (initReq.current.has(guid)) continue;
      initReq.current.add(guid);
      readConfig(guid)
        .then((text) => {
          if (get().tuningSeq !== seq) return;
          const parsed = parseConfigWithTail(text);
          set((s) => ({
            tuningMap:
              s.tuningMap[guid] !== undefined ? s.tuningMap : { ...s.tuningMap, [guid]: parsed.enabled },
          }));
        })
        .catch(() => {
          if (get().tuningSeq !== seq) return;
          set((s) => ({
            tuningMap:
              s.tuningMap[guid] !== undefined ? s.tuningMap : { ...s.tuningMap, [guid]: false },
          }));
        });
    }
  },

  // 强制重新读取磁盘配置（导入到当前设备等场景，selectedGuid 未变时不会触发加载 effect）。
  forceReload() {
    get().dirtyRef.current = false;
    get().configRevisionRef.current = null;
    set((s) => ({ reloadNonce: s.reloadNonce + 1 }));
  },

  markDirty() {
    get().dirtyRef.current = true;
  },

  writableBlocks() {
    const { blocks, inputs } = get();
    return inputs.channelCtx.mode
      ? blocks
      : blocks.filter((b) => !b.channel || b.channel === inputs.channelCtx.first);
  },

  applyPreset(p) {
    const s = get();
    const ctx = s.inputs.channelCtx;
    const blocks = s.blocks;
    const counts: Record<string, number> = {};
    let total = 0;
    const writable = s.writableBlocks();
    total = writable.reduce((n, b) => n + b.bands.length, 0);
    if (ctx.mode) {
      for (const b of blocks) {
        const ch = b.channel ?? ctx.first;
        counts[ch] = (counts[ch] ?? 0) + b.bands.length;
      }
    } else {
      counts[ctx.first] = total;
    }
    const current = ctx.mode ? (counts[ctx.active] ?? 0) : total;
    if (current + p.bands.length > 31) {
      s.notifySink?.(t("notify.maxBands", { current, add: p.bands.length }));
      return undefined;
    }
    const lang = getLang();
    const groupBase = lang === "en" ? (p.group_en ?? p.group) : p.group;
    const nameBase = lang === "en" ? (p.name_en ?? p.name) : p.name;
    const groups = new Set(blocks.map((b) => b.group).filter((g): g is string => !!g));
    const group = nextGroupName(groupBase, groups);
    get().markDirty();
    set((prev) => ({
      blocks: [
        ...prev.blocks,
        ...p.bands.map((b) => ({
          id: crypto.randomUUID(),
          group,
          name: (lang === "en" ? (b.name_en ?? b.name) : b.name) ?? nameBase,
          enabled: true,
          channel: ctx.mode ? ctx.active : undefined,
          bands: [{ fc: b.fc, gain_db: b.gain_db, q: b.q, ...(b.kind ? { kind: b.kind } : {}) }],
        })),
      ],
    }));
    return group;
  },

  addBand(kind = "peaking", channel) {
    const s = get();
    const ctx = s.inputs.channelCtx;
    const counts: Record<string, number> = {};
    if (ctx.mode) {
      for (const b of s.blocks) {
        const ch = b.channel ?? ctx.first;
        counts[ch] = (counts[ch] ?? 0) + b.bands.length;
      }
    }
    const writable = s.writableBlocks();
    const total = ctx.mode ? undefined : writable.reduce((n, b) => n + b.bands.length, 0);
    const current = ctx.mode ? (counts[ctx.active] ?? 0) : (total ?? 0);
    if (current >= 31) {
      s.notifySink?.(t("notify.maxBandsChannel"));
      return;
    }
    s.markDirty();
    set((prev) => ({
      blocks: [
        ...prev.blocks,
        {
          id: crypto.randomUUID(),
          enabled: true,
          channel: ctx.mode ? (channel ?? ctx.active) : undefined,
          bands: [
            kind === "low_shelf"
              ? { fc: 200, gain_db: 0, q: 0.707, kind }
              : kind === "high_shelf"
                ? { fc: 6000, gain_db: 0, q: 0.707, kind }
                : kind === "low_pass"
                  ? { fc: 1000, gain_db: 0, q: 0.707, kind }
                  : kind === "high_pass"
                    ? { fc: 80, gain_db: 0, q: 0.707, kind }
                    : { fc: 1000, gain_db: 0, q: 1, kind: "peaking" },
          ],
        },
      ],
    }));
  },

  addEffect(type) {
    const ctx = get().inputs.channelCtx;
    get().markDirty();
    set((prev) => {
      const channels = type === "preamp" && ctx.mode ? [ctx.active] : undefined;
      const id = `${type}:${channels?.length ? channels.join(",") : "all"}`;
      if (prev.effects.some((e) => e.id === id)) return { effects: prev.effects };
      return {
        effects: [
          ...prev.effects,
          {
            id,
            type,
            enabled: true,
            params: defaultEffectParams(type),
            ...(channels ? { channels } : {}),
          },
        ],
      };
    });
  },

  removeEffect(id) {
    get().markDirty();
    set((prev) => ({ effects: prev.effects.filter((e) => e.id !== id) }));
  },

  toggleEffect(id) {
    get().markDirty();
    set((prev) => ({
      effects: prev.effects.map((e) => (e.id === id ? { ...e, enabled: !e.enabled } : e)),
    }));
  },

  patchEffectParam(id, key, value) {
    get().markDirty();
    set((prev) => ({
      effects: prev.effects.map((e) =>
        e.id === id ? { ...e, params: { ...(e.params ?? {}), [key]: value } } : e,
      ),
    }));
  },

  patchEffectSemantic(id, strength) {
    get().markDirty();
    set((prev) => ({
      effects: prev.effects.map((e) =>
        e.id === id
          ? {
              ...e,
              params: applySemanticStrength(e.type, strength, {
                ...defaultEffectParams(e.type),
                ...(e.params ?? {}),
              }),
            }
          : e,
      ),
    }));
  },

  removeBlock(idx) {
    get().markDirty();
    set((prev) => ({ blocks: prev.blocks.filter((_, i) => i !== idx) }));
  },

  removeGroup(label) {
    get().markDirty();
    set((prev) => ({ blocks: prev.blocks.filter((b) => b.group !== label) }));
  },

  patchBlock(idx, patch) {
    get().markDirty();
    set((prev) => ({ blocks: prev.blocks.map((b, i) => (i === idx ? { ...b, ...patch } : b)) }));
  },

  patchBand(blockIdx, bandIdx, patch) {
    get().markDirty();
    set((prev) => ({
      blocks: prev.blocks.map((b, i) =>
        i === blockIdx
          ? {
              ...b,
              // 频率变了，语义标签就该跟着频响走：清掉旧名字让 semanticName 回退到感知标签
              ...(patch.fc !== undefined ? { name: undefined } : {}),
              bands: b.bands.map((band, j) => (j === bandIdx ? { ...band, ...patch } : band)),
            }
          : b,
      ),
    }));
  },

  deviceTuningOn(guid) {
    return get().tuningMap[guid] ?? true;
  },

  setChannelPreampMode(on, channelNames) {
    const first = channelNames[0] ?? "L";
    get().markDirty();
    set((prev) => {
      if (!on) {
        // 开启通道选择器：全局基准电平拆成每声道一个
        const globalPreamp = prev.effects.find((e) => e.type === "preamp" && !e.channels?.length);
        if (!globalPreamp) return { effects: prev.effects };
        const gain =
          typeof globalPreamp.params?.gain_db === "number" ? globalPreamp.params.gain_db : 0;
        const perChannel = channelNames.map((ch) => ({
          id: `preamp:${ch}`,
          type: "preamp" as const,
          enabled: globalPreamp.enabled,
          params: { gain_db: gain },
          channels: [ch],
        }));
        return { effects: [...prev.effects.filter((e) => e.type !== "preamp"), ...perChannel] };
      }
      // 关闭通道选择器：按第一声道合并，取消声道标识
      const firstPreamp = prev.effects.find(
        (e) => e.type === "preamp" && e.channels?.includes(first),
      );
      if (!firstPreamp) return { effects: prev.effects };
      const gain = typeof firstPreamp.params?.gain_db === "number" ? firstPreamp.params.gain_db : 0;
      return {
        effects: [
          ...prev.effects.filter((e) => e.type !== "preamp"),
          {
            id: "preamp:all",
            type: "preamp" as const,
            enabled: firstPreamp.enabled,
            params: { gain_db: gain },
          },
        ],
      };
    });
  },

  normalizeChainGain(fs, channelNames, channelOn) {
    const s = get();
    const { updates } = planNormalize(s.blocks, s.effects, channelNames, channelOn, fs);
    if (!updates.length) {
      s.notifySink?.(t("normalize.title.disabled"));
      return;
    }
    s.markDirty();
    set((prev) => {
      let next = prev.effects;
      for (const u of updates) {
        const item: EffectItem = {
          id: u.id,
          type: "preamp",
          enabled: true,
          params: { gain_db: u.gain_db },
          ...(u.channels ? { channels: u.channels } : {}),
        };
        const idx = next.findIndex((e) => e.id === u.id);
        next = idx < 0 ? [...next, item] : next.map((e, i) => (i === idx ? item : e));
      }
      return { effects: next };
    });
    if (channelOn) {
      const summary = updates
        .map((u) => `${u.channels?.[0]} ${u.gain_db > 0 ? "+" : ""}${u.gain_db.toFixed(1)} dB`)
        .join("，");
      s.notifySink?.(t("notify.normalizedByChannel", { summary }));
    } else {
      const u = updates[0];
      s.notifySink?.(
        t("notify.normalized", { db: `${u.gain_db > 0 ? "+" : ""}${u.gain_db.toFixed(1)}` }),
      );
    }
  },

  toggleDeviceTuning(guid) {
    const next = !get().deviceTuningOn(guid);
    set((prev) => ({ tuningMap: { ...prev.tuningMap, [guid]: next } }));
    if (guid === get().inputs.selectedGuid) {
      // 当前设备：走自动保存（buildToml 会带上 enabled）。
      get().markDirty();
    } else {
      // 非当前设备：直接改写目标配置的 enabled（只翻转总开关，不动内容），
      // 否则切过去会被磁盘旧值覆盖。
      readConfig(guid)
        .then((text) => {
          const parsed = parseConfigWithTail(text);
          const content =
            buildToml(parsed.blocks, next, normalizeEffects(parsed.effects), get().inputs.channelCtx) +
            parsed.tail;
          return get().writeConfigSafe(guid, content);
        })
        .catch((e: unknown) => get().errorSink?.(friendlyError(e)));
    }
  },
}));
