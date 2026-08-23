import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { friendlyError, readConfig, writeConfig } from "../lib/api";
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
import { useInterval } from "./useInterval";
import { getLang, t } from "../lib/i18n/core";

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

export function useConfig(
  selectedGuid: string | null,
  onError: (msg: string) => void,
  notify: (msg: string) => void,
  channelCtx: ChannelCtx = { mode: false, first: "L", active: "L" },
  deviceGuids: string[] = [],
) {
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [effects, setEffects] = useState<EffectItem[]>([]);
  const [tuningMap, setTuningMap] = useState<Record<string, boolean>>({});
  const [loaded, setLoaded] = useState(false);
  const saveTimer = useRef<number | undefined>(undefined);
  const dirtyRef = useRef(false);
  const tailRef = useRef("");
  const initReqRef = useRef<Set<string>>(new Set());

  // 设备列表加载后：为每个未缓存的设备读取启用状态，
  // 保证标签页调音开关初次打开就显示正确（不再默认“开”）。
  useEffect(() => {
    if (deviceGuids.length === 0) return;
    let alive = true;
    for (const guid of deviceGuids) {
      if (initReqRef.current.has(guid)) continue;
      initReqRef.current.add(guid);
      readConfig(guid)
        .then((text) => {
          if (!alive) return;
          const parsed = parseConfigWithTail(text);
          setTuningMap((prev) =>
            prev[guid] !== undefined ? prev : { ...prev, [guid]: parsed.enabled },
          );
        })
        .catch(() => {
          if (!alive) return;
          setTuningMap((prev) =>
            prev[guid] !== undefined ? prev : { ...prev, [guid]: false },
          );
        });
    }
    return () => {
      alive = false;
    };
  }, [deviceGuids]);

  useEffect(() => {
    return () => {
      window.clearTimeout(saveTimer.current);
    };
  }, []);

  // 兜底：任何 blocks 变化后给缺失稳定 id 的块补 id（拖拽依赖稳定键）
  useEffect(() => {
    setBlocks((prev) => {
      if (prev.every((b) => b.id)) return prev;
      return ensureBlockIds(prev);
    });
  }, [blocks]);

  useEffect(() => {
    if (!selectedGuid) return;
    let alive = true;
    setLoaded(false);
    readConfig(selectedGuid)
      .then((text) => {
        if (!alive) return;
        try {
          const parsed = parseConfigWithTail(text);
          setBlocks(ensureBlockIds(parsed.blocks));
          setEffects(normalizeEffects(parsed.effects));
          tailRef.current = parsed.tail;
          setTuningMap((prev) =>
            prev[selectedGuid] === parsed.enabled ? prev : { ...prev, [selectedGuid]: parsed.enabled },
          );
        } catch {
          setBlocks([]);
          tailRef.current = "";
        }
        onError("");
        setLoaded(true);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setBlocks([]);
        tailRef.current = "";
        onError(friendlyError(e));
        setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, [selectedGuid, onError]);

  // 监控 config 目录热更新：外部/驱动改写 config.toml 时自动刷新 UI（编辑中跳过，避免覆盖手头改动）
  const pollConfig = useCallback(() => {
    if (!selectedGuid || dirtyRef.current) return;
    readConfig(selectedGuid)
      .then((text) => {
        if (dirtyRef.current) return;
        const parsed = parseConfigWithTail(text);
        tailRef.current = parsed.tail;
        setTuningMap((prev) =>
          prev[selectedGuid] === parsed.enabled ? prev : { ...prev, [selectedGuid]: parsed.enabled },
        );
        setEffects((prev) => {
          const next = normalizeEffects(parsed.effects);
          return effectsEqual(prev, next) ? prev : next;
        });
        setBlocks((prev) => {
          const next = parsed.blocks;
          if (
            prev.length === next.length &&
            prev.every((b, i) => blocksEqualShape(b, next[i], channelCtx.first))
          ) {
            return prev;
          }
          return mergeBlockIds(prev, next, channelCtx.first);
        });
      })
      .catch(() => {});
  }, [selectedGuid, channelCtx.first]);

  useInterval(pollConfig, selectedGuid && loaded ? 2000 : null);

  // 自动保存（300ms 去抖，原子写由 Rust 侧负责）
  useEffect(() => {
    if (!selectedGuid || !loaded || !dirtyRef.current) return;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      const effective = tuningMap[selectedGuid] ?? true;
      const content = buildToml(blocks, effective, effects, channelCtx) + tailRef.current;
      writeConfig(selectedGuid, content)
        .then(() => {
          dirtyRef.current = false;
        })
        .catch((e: unknown) => onError(friendlyError(e)));
    }, 300);
    return () => window.clearTimeout(saveTimer.current);
  }, [blocks, effects, tuningMap, selectedGuid, loaded, channelCtx.mode, channelCtx.first]);

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

  const markDirty = useCallback(() => {
    dirtyRef.current = true;
  }, []);

  const applyPreset = useCallback((p: PresetLibraryEntry): string | undefined => {
    const current = channelCtx.mode ? (channelBandCounts[channelCtx.active] ?? 0) : totalBands;
    if (current + p.bands.length > 31) {
      notify(t("notify.maxBands", { current, add: p.bands.length }));
      return undefined;
    }
    const lang = getLang();
    const groupBase = lang === "en" ? (p.group_en ?? p.group) : p.group;
    const nameBase = lang === "en" ? (p.name_en ?? p.name) : p.name;
    const groups = new Set(blocks.map((b) => b.group).filter((g): g is string => !!g));
    const group = nextGroupName(groupBase, groups);
    markDirty();
    setBlocks((prev) => {
      return [
        ...prev,
        ...p.bands.map((b) => ({
          id: crypto.randomUUID(),
          group,
          name: (lang === "en" ? (b.name_en ?? b.name) : b.name) ?? nameBase,
          enabled: true,
          channel: channelCtx.mode ? channelCtx.active : undefined,
          bands: [{ fc: b.fc, gain_db: b.gain_db, q: b.q, ...(b.kind ? { kind: b.kind } : {}) }],
        })),
      ];
    });
    return group;
  }, [channelCtx.mode, channelCtx.active, channelBandCounts, totalBands, blocks, notify, markDirty]);

  const addBand = useCallback((kind: PeqBandKind = "peaking", channel?: string) => {
    const current = channelCtx.mode ? (channelBandCounts[channelCtx.active] ?? 0) : totalBands;
    if (current >= 31) {
      notify(t("notify.maxBandsChannel"));
      return;
    }
    markDirty();
    setBlocks((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        enabled: true,
        channel: channelCtx.mode ? (channel ?? channelCtx.active) : undefined,
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
    ]);
  }, [channelCtx.mode, channelCtx.active, channelBandCounts, totalBands, notify, markDirty]);

  const addEffect = useCallback((type: string) => {
    markDirty();
    setEffects((prev) => {
      const channels =
        type === "preamp" && channelCtx.mode ? [channelCtx.active] : undefined;
      const id = `${type}:${channels?.length ? channels.join(",") : "all"}`;
      if (prev.some((e) => e.id === id)) return prev;
      return [
        ...prev,
        {
          id,
          type,
          enabled: true,
          params: defaultEffectParams(type),
          ...(channels ? { channels } : {}),
        },
      ];
    });
  }, [channelCtx.mode, channelCtx.active, markDirty]);

  const removeEffect = useCallback((id: string) => {
    markDirty();
    setEffects((prev) => prev.filter((e) => e.id !== id));
  }, [markDirty]);

  const toggleEffect = useCallback((id: string) => {
    markDirty();
    setEffects((prev) => prev.map((e) => (e.id === id ? { ...e, enabled: !e.enabled } : e)));
  }, [markDirty]);

  const patchEffectParam = useCallback((id: string, key: string, value: number | string) => {
    markDirty();
    setEffects((prev) =>
      prev.map((e) => (e.id === id ? { ...e, params: { ...(e.params ?? {}), [key]: value } } : e)),
    );
  }, [markDirty]);

  const patchEffectSemantic = useCallback((id: string, strength: number) => {
    markDirty();
    setEffects((prev) =>
      prev.map((e) =>
        e.id === id
          ? { ...e, params: applySemanticStrength(e.type, strength, { ...defaultEffectParams(e.type), ...(e.params ?? {}) }) }
          : e,
      ),
    );
  }, [markDirty]);

  const removeBlock = useCallback((idx: number) => {
    markDirty();
    setBlocks((prev) => prev.filter((_, i) => i !== idx));
  }, [markDirty]);

  const removeGroup = useCallback((label: string) => {
    markDirty();
    setBlocks((prev) => prev.filter((b) => b.group !== label));
  }, [markDirty]);

  const patchBlock = useCallback((idx: number, patch: Partial<Block>) => {
    markDirty();
    setBlocks((prev) => prev.map((b, i) => (i === idx ? { ...b, ...patch } : b)));
  }, [markDirty]);

  const patchBand = useCallback((blockIdx: number, bandIdx: number, patch: BandPatch) => {
    markDirty();
    setBlocks((prev) =>
      prev.map((b, i) =>
        i === blockIdx
          ? {
              ...b,
              // 频率变了，语义标签就该跟着频响走：清掉旧名字让 semanticName 回退到感知标签
              ...(patch.fc !== undefined ? { name: undefined } : {}),
              bands: b.bands.map((band, j) => (j === bandIdx ? { ...band, ...patch } : band)),
            }
          : b,
      ),
    );
  }, [markDirty]);

  const deviceTuningOn = useCallback((guid: string) => tuningMap[guid] ?? true, [tuningMap]);
  const toggleDeviceTuning = useCallback(
    (guid: string) => {
      const next = !deviceTuningOn(guid);
      setTuningMap((prev) => ({ ...prev, [guid]: next }));
      if (guid === selectedGuid) {
        // 当前设备：走自动保存（buildToml 会带上 enabled）。
        markDirty();
      } else {
        // 非当前设备：直接改写目标配置的 enabled（只翻转总开关，不动内容），
        // 否则切过去会被磁盘旧值覆盖。
        readConfig(guid)
          .then((text) => {
            const parsed = parseConfigWithTail(text);
            const content =
              buildToml(parsed.blocks, next, normalizeEffects(parsed.effects), channelCtx) +
              parsed.tail;
            return writeConfig(guid, content);
          })
          .catch((e: unknown) => onError(friendlyError(e)));
      }
    },
    [deviceTuningOn, selectedGuid, channelCtx, onError, markDirty],
  );

  return {
    blocks,
    setBlocks,
    effects,
    setEffects,
    tuningMap,
    loaded,
    dirtyRef,
    markDirty,
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
  };
}
