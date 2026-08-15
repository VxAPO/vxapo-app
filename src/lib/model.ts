// VxAPO App — 数据模型（UI 设计规范 01 契约：块 ↔ [[effects]] peq）

export type ViewMode = "preset" | "advanced";
export type SideSection = "preset" | "custom" | "advanced";

export interface Band {
  fc: number;
  gain_db: number;
  q: number;
}

/** 一个块 = 一个 [[effects]] type="peq"；name/group 仅供 APP（driver 忽略）。 */
export interface Block {
  /** 客户端稳定 id（不写入 TOML），拖拽/分组用。 */
  id?: string;
  group?: string;
  name?: string;
  enabled: boolean;
  bands: Band[];
}

export interface Device {
  index: number;
  name: string;
  guid: string;
  installed_version: string;
  install_mode: string;
  slots: Record<string, string | null>;
  sample_rate?: number | null;
  channels?: number | null;
  bit_depth?: number | null;
  kind?: "playback" | "capture" | null;
  volume?: number | null;
  eapo?: string;
  lost_slot?: string;
}

export interface PresetLibraryEntry {
  id: string;
  group: string;
  name: string;
  desc: string;
  /** 感知配色（自定义预设可自选，缺省按频段推导） */
  color?: string;
  bands: (Band & { name?: string })[];
}

export type ThemeMode = "light" | "dark" | "system";
