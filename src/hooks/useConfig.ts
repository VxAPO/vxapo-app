// VxAPO App — 配置状态机适配层（决策 4 阶段 A-2：状态与动作已移入 stores/configStore）。
//
// 本 hook 只负责：注入错误/提示出口、把输入按值推入 store、驱动「切设备加载 / 300ms
// 去抖保存 / 2s 轮询 / 可见性暂停」四类 React 生命周期触发，并派生 totalBands 与
// channelBandCounts。返回值与重构前逐字段一致，消费方无需改动。
import { useCallback, useEffect, useMemo } from "react";
import type { Block, EffectItem, PeqBandKind, PresetLibraryEntry } from "../lib/model";
import { useConfigStore } from "../stores/configStore";
import { useUiStore } from "../stores/uiStore";
import type { BandPatch } from "../lib/blocks";
import type { ChannelCtx } from "../lib/toml";
import { useInterval } from "./useInterval";

export function useConfig(
  selectedGuid: string | null,
  channelCtx: ChannelCtx = { mode: false, first: "L", active: "L" },
  deviceGuids: string[] = [],
) {
  const blocks = useConfigStore((s) => s.blocks);
  const effects = useConfigStore((s) => s.effects);
  const tuningMap = useConfigStore((s) => s.tuningMap);
  const loaded = useConfigStore((s) => s.loaded);
  const configChannelMode = useConfigStore((s) => s.configChannelMode);
  const pollPaused = useConfigStore((s) => s.pollPaused);
  const reloadNonce = useConfigStore((s) => s.reloadNonce);
  const dirtyRef = useConfigStore((s) => s.dirtyRef);

  // 出口注入：错误条与 Toast 都指向 uiStore（决策 4 阶段 A 收尾），卸载即摘掉。
  useEffect(() => {
    const st = useConfigStore.getState();
    const ui = useUiStore.getState();
    st.setErrorSink(ui.setLoadErr);
    st.setNotifySink(ui.notify);
    return () => {
      const s = useConfigStore.getState();
      s.setErrorSink(null);
      s.setNotifySink(null);
    };
  }, []);

  // 输入按值推入（对象/数组每次渲染都是新引用，store 内部按值比较后才写入）。
  const guidKey = deviceGuids.join("|");
  useEffect(() => {
    useConfigStore.getState().setInputs({ selectedGuid, channelCtx, deviceGuids });
    // channelCtx 每次渲染都是新对象，故依赖它的三个原始字段
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGuid, channelCtx.mode, channelCtx.first, channelCtx.active, guidKey]);

  // 设备列表加载后：为每个未缓存的设备读取启用状态（initReq 去重，仅集合变化时触发）。
  useEffect(() => {
    useConfigStore.getState().initDeviceTuning();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guidKey]);

  // 切设备 / forceReload → 重新读取磁盘配置。
  useEffect(() => {
    void useConfigStore.getState().load();
  }, [selectedGuid, reloadNonce]);

  // 兜底：blocks 变化后给缺失稳定 id 的块补 id（拖拽依赖稳定键）。
  useEffect(() => {
    useConfigStore.getState().ensureIds();
  }, [blocks]);

  // 窗口不可见（最小化/遮挡）时暂停轮询：恢复可见立即补一次，最终状态与常驻轮询一致
  useEffect(() => {
    const onVisibility = () => {
      const hidden = document.visibilityState === "hidden";
      const st = useConfigStore.getState();
      st.setPollPaused(hidden);
      if (!hidden) st.poll();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  useInterval(
    () => useConfigStore.getState().poll(),
    selectedGuid && loaded && !pollPaused ? 2000 : null,
  );

  // 自动保存（300ms 去抖、脏标记判断都在 store 内）。
  useEffect(() => {
    useConfigStore.getState().scheduleSave();
    return () => useConfigStore.getState().cancelSave();
  }, [blocks, effects, tuningMap, selectedGuid, loaded, channelCtx.mode, channelCtx.first]);

  useEffect(() => () => useConfigStore.getState().cancelSave(), []);

  const writableBlocks = useMemo(
    () =>
      channelCtx.mode
        ? blocks
        : blocks.filter((b) => !b.channel || b.channel === channelCtx.first),
    [blocks, channelCtx.mode, channelCtx.first],
  );
  const totalBands = useMemo(
    () => writableBlocks.reduce((n, b) => n + b.bands.length, 0),
    [writableBlocks],
  );
  const channelBandCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    if (!channelCtx.mode) {
      counts[channelCtx.first] = totalBands;
      return counts;
    }
    for (const b of blocks) {
      const ch = b.channel ?? channelCtx.first;
      counts[ch] = (counts[ch] ?? 0) + b.bands.length;
    }
    return counts;
  }, [blocks, totalBands, channelCtx.mode, channelCtx.first]);

  // 与原 hook 同签名的置值函数（少数消费方直接调用）。
  const setBlocks = useCallback((next: Block[] | ((prev: Block[]) => Block[])) => {
    const st = useConfigStore.getState();
    const value = typeof next === "function" ? next(st.blocks) : next;
    useConfigStore.setState({ blocks: value });
  }, []);
  const setEffects = useCallback((next: EffectItem[] | ((prev: EffectItem[]) => EffectItem[])) => {
    const st = useConfigStore.getState();
    const value = typeof next === "function" ? next(st.effects) : next;
    useConfigStore.setState({ effects: value });
  }, []);

  const markDirty = useCallback(() => useConfigStore.getState().markDirty(), []);
  const forceReload = useCallback(() => useConfigStore.getState().forceReload(), []);
  const applyPreset = useCallback(
    (p: PresetLibraryEntry): string | undefined => useConfigStore.getState().applyPreset(p),
    [],
  );
  const addBand = useCallback(
    (kind: PeqBandKind = "peaking", channel?: string) =>
      useConfigStore.getState().addBand(kind, channel),
    [],
  );
  const addEffect = useCallback((type: string) => useConfigStore.getState().addEffect(type), []);
  const removeEffect = useCallback((id: string) => useConfigStore.getState().removeEffect(id), []);
  const toggleEffect = useCallback((id: string) => useConfigStore.getState().toggleEffect(id), []);
  const patchEffectParam = useCallback(
    (id: string, key: string, value: number | string) =>
      useConfigStore.getState().patchEffectParam(id, key, value),
    [],
  );
  const patchEffectSemantic = useCallback(
    (id: string, strength: number) => useConfigStore.getState().patchEffectSemantic(id, strength),
    [],
  );
  const removeBlock = useCallback((idx: number) => useConfigStore.getState().removeBlock(idx), []);
  const removeGroup = useCallback(
    (label: string) => useConfigStore.getState().removeGroup(label),
    [],
  );
  const patchBlock = useCallback(
    (idx: number, patch: Partial<Block>) => useConfigStore.getState().patchBlock(idx, patch),
    [],
  );
  const patchBand = useCallback(
    (blockIdx: number, bandIdx: number, patch: BandPatch) =>
      useConfigStore.getState().patchBand(blockIdx, bandIdx, patch),
    [],
  );
  const deviceTuningOn = useCallback(
    (guid: string) => useConfigStore.getState().deviceTuningOn(guid),
    [],
  );
  const setChannelPreampMode = useCallback(
    (on: boolean, channelNames: string[]) =>
      useConfigStore.getState().setChannelPreampMode(on, channelNames),
    [],
  );
  const normalizeChainGain = useCallback(
    (fs: number, channelNames: string[], channelOn: boolean) =>
      useConfigStore.getState().normalizeChainGain(fs, channelNames, channelOn),
    [],
  );
  const toggleDeviceTuning = useCallback(
    (guid: string) => useConfigStore.getState().toggleDeviceTuning(guid),
    [],
  );

  return {
    blocks,
    setBlocks,
    effects,
    setEffects,
    tuningMap,
    loaded,
    configChannelMode,
    dirtyRef,
    markDirty,
    forceReload,
    applyPreset,
    addBand,
    addEffect,
    removeEffect,
    toggleEffect,
    patchEffectParam,
    patchEffectSemantic,
    removeBlock,
    removeGroup,
    patchBlock,
    patchBand,
    totalBands,
    channelBandCounts,
    deviceTuningOn,
    toggleDeviceTuning,
    setChannelPreampMode,
    normalizeChainGain,
  };
}
