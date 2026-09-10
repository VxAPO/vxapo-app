// VxAPO App — 数据模型（UI 设计规范 01 契约：块 ↔ [[effects]] peq）

export type ViewMode = "preset" | "advanced";
export type SideSection = "preset" | "custom" | "advanced";

export type PeqBandKind = "peaking" | "low_shelf" | "high_shelf" | "low_pass" | "high_pass";

export interface Band {
  fc: number;
  gain_db: number;
  q: number;
  /** 滤波器类型，缺省 peaking；TOML 中写为 [[effects.bands]].type */
  kind?: PeqBandKind;
}

/** 一个块 = 一个 [[effects]] type="peq"；name/group 仅供 APP（driver 忽略）。 */
export interface Block {
  /** 客户端稳定 id（不写入 TOML），拖拽/分组用。 */
  id?: string;
  group?: string;
  name?: string;
  /** 配置里 channels 的第一个声道短名（无声道分配时，通道模式下按第一声道处理） */
  channel?: string;
  enabled: boolean;
  bands: Band[];
}

export interface Device {
  index: number;
  name: string;
  guid: string;
  device_id?: string | null;
  connection?: string | null;
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

/** 旧 GUID 安装记录（Windows 重新枚举端点后可能残留） */
export interface StaleInstall {
  guid: string;
  device_instance_id: string;
  display_name: string;
  config_path?: string | null;
  config_mtime_ms?: number | null;
  snapshot_path?: string | null;
  snapshot_mtime_ms?: number | null;
  premix_slot?: string | null;
  postmix_slot?: string | null;
  inferred_mode: string;
  has_child_backup: boolean;
  has_sysfx_backup: boolean;
  target_guid?: string | null;
  target_name?: string | null;
  target_state: "matched_partial" | "matched_healthy" | "unmatched";
}

export interface MigrationReport {
  success: boolean;
  target_guid: string;
  config_from?: string | null;
  snapshot_from?: string | null;
  config_migrated: boolean;
  snapshot_migrated: boolean;
  install_repaired: boolean;
  removed_guids: string[];
  warnings: string[];
}

export interface PresetLibraryEntry {
  id: string;
  group: string;
  name: string;
  desc: string;
  /** 英文显示名（缺省回退中文） */
  group_en?: string;
  name_en?: string;
  desc_en?: string;
  /** 感知配色（自定义预设可自选，缺省按频段推导） */
  color?: string;
  bands: (Band & { name?: string; name_en?: string })[];
}

export interface PresetMetaEntry {
  presetId: string;
  accent: string;
}

export type PresetMeta = Record<string, PresetMetaEntry>;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function isNamedBand(v: unknown): v is Band & { name?: string; name_en?: string } {
  return (
    isRecord(v) &&
    typeof v.fc === "number" &&
    typeof v.gain_db === "number" &&
    typeof v.q === "number" &&
    (v.name === undefined || typeof v.name === "string") &&
    (v.name_en === undefined || typeof v.name_en === "string")
  );
}

export function isPresetLibraryEntry(v: unknown): v is PresetLibraryEntry {
  return (
    isRecord(v) &&
    typeof v.id === "string" &&
    typeof v.group === "string" &&
    typeof v.name === "string" &&
    typeof v.desc === "string" &&
    (v.color === undefined || typeof v.color === "string") &&
    (v.group_en === undefined || typeof v.group_en === "string") &&
    (v.name_en === undefined || typeof v.name_en === "string") &&
    (v.desc_en === undefined || typeof v.desc_en === "string") &&
    Array.isArray(v.bands) &&
    v.bands.every(isNamedBand)
  );
}

export function isPresetMeta(v: unknown): v is PresetMeta {
  return (
    isRecord(v) &&
    Object.values(v).every(
      (m) =>
        isRecord(m) &&
        typeof m.presetId === "string" &&
        typeof m.accent === "string",
    )
  );
}

/** 非 peq 效果器（写入 config.toml 的 [[effects]]，driver 原生支持） */
export interface EffectItem {
  /** 客户端稳定 id（不写入 TOML），同类型多声道效果器（如 preamp）用 id 区分 */
  id?: string;
  type: string;
  enabled: boolean;
  /** 参数（键与 driver 一致），没有配置的键不写 TOML */
  params?: Record<string, number | string>;
  /** 声道作用域；缺省 = 所有声道。通道模式下 preamp 按声道生成 */
  channels?: string[];
}

export type ThemeMode = "light" | "dark" | "system";
