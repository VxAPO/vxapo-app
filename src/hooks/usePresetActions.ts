import { useCallback, useEffect, useMemo, useState } from "react";
import type { Block, PresetLibraryEntry } from "../lib/model";
import { presetAccent } from "../lib/blocks";
import { loadCustomPresets, loadPresetMeta, saveStored } from "../lib/storage";
import { t } from "../lib/i18n/core";

interface UsePresetActionsOptions {
  blocks: Block[];
  selectedIds: string[];
  applyPreset: (p: PresetLibraryEntry) => string | undefined;
  notify: (msg: string) => void;
  clearSelection: () => void;
}

/** 预设库状态与动作：自定义预设保存/删除/应用、组配色映射。 */
export function usePresetActions({
  blocks,
  selectedIds,
  applyPreset,
  notify,
  clearSelection,
}: UsePresetActionsOptions) {
  const [presetMeta, setPresetMeta] = useState(loadPresetMeta);
  const [customPresets, setCustomPresets] = useState(loadCustomPresets);
  const [savePresetOpen, setSavePresetOpen] = useState(false);
  const [savePresetBlocks, setSavePresetBlocks] = useState<Block[]>([]);
  const [savePresetDefaultName, setSavePresetDefaultName] = useState(
    t("preset.name.placeholder"),
  );
  const [deletePresetTarget, setDeletePresetTarget] =
    useState<PresetLibraryEntry | null>(null);

  useEffect(() => {
    saveStored("vxapo.customPresets", customPresets);
  }, [customPresets]);

  useEffect(() => {
    saveStored("vxapo.presetMeta", presetMeta);
  }, [presetMeta]);

  // 已使用：当前 blocks 里还存在该预设注册过组标签的卡片
  const usedPresetIds = useMemo(() => {
    const used = new Set<string>();
    for (const [label, meta] of Object.entries(presetMeta)) {
      if (blocks.some((b) => b.group === label)) used.add(meta.presetId);
    }
    return used;
  }, [blocks, presetMeta]);

  // 卡片配色：预设注册的组色优先，否则按频段感知推导
  const accentOf = useCallback(
    (b: Block): string =>
      (b.group ? presetMeta[b.group]?.accent : undefined) ?? presetAccent(b.bands),
    [presetMeta],
  );

  const openSavePreset = useCallback(() => {
    const picked = blocks.filter((b) => selectedIds.includes(b.id ?? ""));
    if (!picked.length) return;
    setSavePresetBlocks(picked);
    setSavePresetDefaultName(
      `${t("preset.name.placeholder")} ${customPresets.length + 1}`,
    );
    setSavePresetOpen(true);
  }, [blocks, selectedIds, customPresets]);

  const handleApplyPreset = useCallback(
    (p: PresetLibraryEntry) => {
      if (usedPresetIds.has(p.id)) {
        notify(t("notify.presetAdded"));
        return;
      }
      const label = applyPreset(p);
      if (label) {
        setPresetMeta((prev) => ({
          ...prev,
          [label]: { presetId: p.id, accent: p.color ?? presetAccent(p.bands) },
        }));
      }
    },
    [usedPresetIds, applyPreset, notify],
  );

  const handleSavePreset = useCallback(
    (
      name: string,
      desc: string,
      color: string,
      descriptions: string[],
    ) => {
      const entry: PresetLibraryEntry = {
        id: `custom-${Date.now()}`,
        group: t("custom"),
        name,
        desc,
        color,
        bands: savePresetBlocks.map((b, i) => ({
          ...(b.bands[0] ?? { fc: 1000, gain_db: 0, q: 1 }),
          name: descriptions[i] || undefined,
        })),
      };
      setCustomPresets((prev) => [...prev, entry]);
      setSavePresetOpen(false);
      clearSelection();
      notify(t("notify.presetSaved"));
    },
    [savePresetBlocks, notify, clearSelection],
  );

  const confirmDeletePreset = useCallback(() => {
    if (!deletePresetTarget) return;
    setCustomPresets((prev) => prev.filter((p) => p.id !== deletePresetTarget.id));
    setDeletePresetTarget(null);
    notify(t("notify.presetDeleted"));
  }, [deletePresetTarget, notify]);

  const closeDeletePreset = useCallback((open: boolean) => {
    if (!open) setDeletePresetTarget(null);
  }, []);

  return {
    presetMeta,
    customPresets,
    savePresetOpen,
    savePresetBlocks,
    savePresetDefaultName,
    deletePresetTarget,
    usedPresetIds,
    usedPresetList: [...usedPresetIds],
    accentOf,
    openSavePreset,
    handleApplyPreset,
    handleSavePreset,
    confirmDeletePreset,
    closeDeletePreset,
    setSavePresetOpen,
    setDeletePresetTarget,
  };
}
