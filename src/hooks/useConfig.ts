import { useEffect, useMemo, useRef, useState } from "react";
import { friendlyError, readConfig, writeConfig } from "../lib/api";
import type { Block, EffectItem, PresetLibraryEntry } from "../lib/model";
import { buildToml, parseConfigWithTail } from "../lib/toml";
import { applySemanticStrength, defaultEffectParams, effectsEqual } from "../lib/effects";
import {
  blocksEqualShape,
  ensureBlockIds,
  mergeBlockIds,
  nextGroupName,
  type BandPatch,
} from "../lib/blocks";

function normalizeEffects(list: EffectItem[]): EffectItem[] {
  return list.map((e) => ({ ...e, params: { ...defaultEffectParams(e.type), ...(e.params ?? {}) } }));
}

export function useConfig(
  selectedGuid: string | null,
  onError: (msg: string) => void,
  notify: (msg: string) => void,
) {
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [effects, setEffects] = useState<EffectItem[]>([]);
  const [tuningMap, setTuningMap] = useState<Record<string, boolean>>({});
  const [loaded, setLoaded] = useState(false);
  const saveTimer = useRef<number | undefined>(undefined);
  const dirtyRef = useRef(false);
  const tailRef = useRef("");

  // 兜底：任何 blocks 变化后给缺失稳定 id 的块补 id（拖拽依赖稳定键）
  useEffect(() => {
    setBlocks((prev) => {
      if (prev.every((b) => b.id)) return prev;
      return ensureBlockIds(prev);
    });
  }, [blocks]);

  useEffect(() => {
    if (!selectedGuid) return;
    setLoaded(false);
    readConfig(selectedGuid)
      .then((text) => {
        try {
          const parsed = parseConfigWithTail(text);
          setBlocks(ensureBlockIds(parsed.blocks));
          setEffects(normalizeEffects(parsed.effects));
          tailRef.current = parsed.tail;
          setTuningMap((prev) => ({ ...prev, [selectedGuid]: parsed.enabled }));
        } catch {
          setBlocks([]);
          tailRef.current = "";
        }
        onError("");
        setLoaded(true);
      })
      .catch((e: unknown) => {
        setBlocks([]);
        tailRef.current = "";
        onError(friendlyError(e));
        setLoaded(true);
      });
  }, [selectedGuid, onError]);

  // 监控 config 目录热更新：外部/驱动改写 config.toml 时自动刷新 UI（编辑中跳过，避免覆盖手头改动）
  useEffect(() => {
    if (!selectedGuid || !loaded) return;
    const timer = window.setInterval(() => {
      if (dirtyRef.current) return;
      readConfig(selectedGuid)
        .then((text) => {
          if (dirtyRef.current) return;
          const parsed = parseConfigWithTail(text);
          tailRef.current = parsed.tail;
          setTuningMap((prev) => ({ ...prev, [selectedGuid]: parsed.enabled }));
          setEffects((prev) => {
            const next = normalizeEffects(parsed.effects);
            return effectsEqual(prev, next) ? prev : next;
          });
          setBlocks((prev) => {
            const next = parsed.blocks;
            if (prev.length === next.length && prev.every((b, i) => blocksEqualShape(b, next[i]))) {
              return prev;
            }
            return mergeBlockIds(prev, next);
          });
        })
        .catch(() => {});
    }, 2000);
    return () => window.clearInterval(timer);
  }, [selectedGuid, loaded]);

  // 自动保存（300ms 去抖，原子写由 Rust 侧负责）
  useEffect(() => {
    if (!selectedGuid || !loaded || !dirtyRef.current) return;
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      const effective = tuningMap[selectedGuid] ?? true;
      const content = buildToml(blocks, effective, effects) + tailRef.current;
      writeConfig(selectedGuid, content)
        .then(() => {
          dirtyRef.current = false;
        })
        .catch((e: unknown) => onError(friendlyError(e)));
    }, 300);
    return () => window.clearTimeout(saveTimer.current);
  }, [blocks, effects, tuningMap, selectedGuid, loaded]);

  const totalBands = useMemo(() => blocks.reduce((n, b) => n + b.bands.length, 0), [blocks]);

  const markDirty = () => {
    dirtyRef.current = true;
  };

  const applyPreset = (p: PresetLibraryEntry): string | undefined => {
    if (totalBands + p.bands.length > 31) {
      notify(`最多 31 段，当前 ${totalBands} 段，添加 ${p.bands.length} 段将超限`);
      return undefined;
    }
    const groups = new Set(blocks.map((b) => b.group).filter((g): g is string => !!g));
    const group = nextGroupName(p.group, groups);
    markDirty();
    setBlocks((prev) => {
      return [
        ...prev,
        ...p.bands.map((b) => ({
          id: crypto.randomUUID(),
          group,
          name: b.name ?? p.name,
          enabled: true,
          bands: [{ fc: b.fc, gain_db: b.gain_db, q: b.q }],
        })),
      ];
    });
    return group;
  };

  const addBand = () => {
    if (totalBands >= 31) {
      notify("最多 31 段，已达到上限");
      return;
    }
    markDirty();
    setBlocks((prev) => [
      ...prev,
      { id: crypto.randomUUID(), enabled: true, bands: [{ fc: 1000, gain_db: 0, q: 1 }] },
    ]);
  };

  const addEffect = (type: string) => {
    markDirty();
    setEffects((prev) =>
      prev.some((e) => e.type === type) ? prev : [...prev, { type, enabled: true, params: defaultEffectParams(type) }],
    );
  };

  const removeEffect = (type: string) => {
    markDirty();
    setEffects((prev) => prev.filter((e) => e.type !== type));
  };

  const toggleEffect = (type: string) => {
    markDirty();
    setEffects((prev) => prev.map((e) => (e.type === type ? { ...e, enabled: !e.enabled } : e)));
  };

  const patchEffectParam = (type: string, key: string, value: number | string) => {
    markDirty();
    setEffects((prev) =>
      prev.map((e) => (e.type === type ? { ...e, params: { ...(e.params ?? {}), [key]: value } } : e)),
    );
  };

  const patchEffectSemantic = (type: string, strength: number) => {
    markDirty();
    setEffects((prev) =>
      prev.map((e) =>
        e.type === type
          ? { ...e, params: applySemanticStrength(type, strength, { ...defaultEffectParams(type), ...(e.params ?? {}) }) }
          : e,
      ),
    );
  };

  const removeBlock = (idx: number) => {
    markDirty();
    setBlocks((prev) => prev.filter((_, i) => i !== idx));
  };

  const removeGroup = (label: string) => {
    markDirty();
    setBlocks((prev) => prev.filter((b) => b.group !== label));
  };

  const patchBlock = (idx: number, patch: Partial<Block>) => {
    markDirty();
    setBlocks((prev) => prev.map((b, i) => (i === idx ? { ...b, ...patch } : b)));
  };

  const patchBand = (blockIdx: number, bandIdx: number, patch: BandPatch) => {
    markDirty();
    setBlocks((prev) =>
      prev.map((b, i) =>
        i === blockIdx
          ? { ...b, bands: b.bands.map((band, j) => (j === bandIdx ? { ...band, ...patch } : band)) }
          : b,
      ),
    );
  };

  const deviceTuningOn = (guid: string) => tuningMap[guid] ?? true;
  const toggleDeviceTuning = (guid: string) => {
    const next = !deviceTuningOn(guid);
    markDirty();
    setTuningMap((prev) => ({ ...prev, [guid]: next }));
  };

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
    deviceTuningOn,
    toggleDeviceTuning,
  };
}
