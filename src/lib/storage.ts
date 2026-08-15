// VxAPO App — localStorage 安全读写（带类型守卫，避免脏数据进入状态）

import { isPresetLibraryEntry, isPresetMeta, type PresetLibraryEntry, type PresetMeta } from "./model";

function readStored<T>(key: string, guard: (v: unknown) => v is T): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return null;
    const value: unknown = JSON.parse(raw);
    return guard(value) ? value : null;
  } catch {
    return null;
  }
}

export function loadCustomPresets(): PresetLibraryEntry[] {
  return (
    readStored("vxapo.customPresets", (v): v is PresetLibraryEntry[] =>
      Array.isArray(v) && v.every(isPresetLibraryEntry),
    ) ?? []
  );
}

export function loadPresetMeta(): PresetMeta {
  return readStored("vxapo.presetMeta", isPresetMeta) ?? {};
}

export function saveStored(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}
