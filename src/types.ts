// VxAPO App — 共享类型定义（App 引用规范 §五）

export type TabId = "preset" | "effect" | "advanced";
export type Flow = "playback" | "capture";
export type Theme = "light" | "dark" | "system";

export interface Device {
  id: string;
  name: string;
  icon: string;
  flow: Flow;
  installed: boolean;
  format: string;
}

export interface DimensionMapping {
  filter_index: number;
  param: "gain" | "frequency" | "q";
  min_value: number;
  max_value: number;
  interpolation?: "linear" | "logarithmic" | "exponential";
}

export interface Dimension {
  id: string;
  name: string;
  low_label: string;
  high_label: string;
  description: string;
  default_value: number;
  mappings: DimensionMapping[];
}

export interface Filter {
  enabled: boolean;
  type: string;
  frequency: number;
  gain: number;
  q: number;
  label: string;
  source: string;
}

export interface Preset {
  id: string;
  name: string;
  description: string;
  use_case: string;
  icon: string;
  default_intensity: number;
  dimensions: Dimension[];
  filters: Filter[];
}

/** 模块列表中的一条：预设 + 当前强度。 */
export interface ModuleInstance {
  /** 实例唯一标识（同一预设可重复添加，靠 id 区分）。 */
  id: string;
  /** 创建序号（永不变更），用作卡片布局的稳定基准。 */
  seq: number;
  presetId: string;
  intensity: number;
}

export interface InstallStep {
  label: string;
  state: "pending" | "running" | "done" | "error";
}
