// VxAPO App — Tauri 命令封装（UI 设计规范 05：文件系统 + CLI --json）

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Device, MigrationReport, StaleInstall } from "./model";
import { t } from "./i18n/core";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function readConfig(guid: string): Promise<string> {
  if (!isTauri) return "";
  return invoke<string>("read_config", { guid });
}

export interface ConfigReadChecked {
  revision: string;
  /** 内容与传入 revision 相同时为 null（后端已短路，无需回传/解析）。 */
  text: string | null;
}

/** 轮询专用：内容未变时不回传文本，避免每 2s 全量解析 TOML。 */
export async function readConfigChecked(
  guid: string,
  knownRevision: string | null,
): Promise<ConfigReadChecked | null> {
  if (!isTauri) return null;
  return invoke<ConfigReadChecked>("read_config_checked", {
    guid,
    knownRevision,
  });
}

/** 读取界面语言（"zh" / "en"；无记录返回空串）。 */
export async function readLang(): Promise<string> {
  if (!isTauri) return "";
  return invoke<string>("read_lang");
}

/** 写入界面语言（设置里切换时调用，与安装器共用 lang.txt）。 */
export async function writeLang(lang: string): Promise<void> {
  if (!isTauri) return;
  try {
    await invoke("write_lang", { lang });
  } catch {
    /* 尽力而为：写失败时本次会话仍生效 */
  }
}

export async function writeConfig(guid: string, content: string): Promise<void> {
  if (!isTauri) return;
  await invoke("write_config", { guid, content });
}

export async function listDevices(): Promise<Device[]> {
  if (!isTauri) return [];
  return invoke<Device[]>("list_devices");
}

export async function uninstallDevice(guid: string): Promise<void> {
  if (!isTauri) return;
  await invoke("uninstall_device", { guid });
}

/** 旧 GUID 残留列表（只读）。 */
export async function listStaleInstalls(): Promise<StaleInstall[]> {
  if (!isTauri) return [];
  return invoke<StaleInstall[]>("list_stale_installs");
}

/** 迁移旧 GUID 到当前端点（需要管理员，Tauri 侧自动提权）。 */
export async function migrateStaleInstall(
  from: string,
  to: string,
  configFrom?: string | null,
  snapshotFrom?: string | null,
): Promise<MigrationReport | null> {
  if (!isTauri) return null;
  const raw = await invoke<string>("migrate_stale_install", {
    from,
    to,
    configFrom: configFrom ?? null,
    snapshotFrom: snapshotFrom ?? null,
  });
  const line = raw.trim().split("\n").filter(Boolean).pop() ?? "";
  return line ? (JSON.parse(line) as MigrationReport) : null;
}

/** 清理无法匹配活跃端点的旧 GUID 残留。 */
export async function cleanupStaleInstall(guid: string): Promise<void> {
  if (!isTauri) return;
  await invoke<string>("cleanup_stale_install", { guid });
}

/** 修复迁移后 config 的用户 ACL（权限不足时一次性提权修复）。 */
export async function repairStaleAcl(guid: string): Promise<void> {
  if (!isTauri) return;
  await invoke<string>("repair_stale_acl", { guid });
}

export interface InstallResult {
  success: boolean;
  mode?: string | null;
  score?: number | null;
  attempts: number;
  best_mode?: string | null;
  best_score?: number | null;
}

export type InstallProgressEvent =
  | { event: "install_write"; mode: string }
  | { event: "service"; action: "stopping" | "stopped" | "starting" | "running" }
  | { event: "test"; pipe?: string; mode?: string }
  | { event: "retry"; from: string; to: string; reason?: string }
  | {
      event: "complete";
      success: boolean;
      mode?: string;
      score?: number;
      attempts?: number;
      best_mode?: string;
      best_score?: number;
    };

export async function installDevice(guid: string): Promise<InstallResult> {
  if (!isTauri) return { success: false, attempts: 0 };
  return invoke<InstallResult>("install_device", { guid });
}

/** 安装失败后的兜底回滚：清除已写入的注册表配置（CLI uninstall，提权）。 */
export async function rollbackInstall(guid: string): Promise<void> {
  if (!isTauri) return;
  await invoke("rollback_install", { guid });
}

export async function onInstallProgress(
  cb: (ev: InstallProgressEvent) => void,
): Promise<() => void> {
  if (!isTauri) return () => {};
  return listen<InstallProgressEvent>("install-progress", (e) => cb(e.payload));
}

export async function readProgress(tag: string): Promise<string> {
  if (!isTauri) return "";
  return invoke<string>("read_progress", { tag });
}

/** 读取拖拽导入文件内容（Tauri 文件拖放事件路径）。 */
export async function readImportFile(path: string): Promise<string> {
  if (!isTauri) return "";
  return invoke<string>("read_import_file", { path });
}

/** 导出当前设备 config.toml 到用户选择的路径，并在资源管理器中选中。 */
export async function exportConfig(guid: string): Promise<void> {
  if (!isTauri) return;
  const { save } = await import("@tauri-apps/plugin-dialog");
  const path = await save({
    title: t("export.title"),
    defaultPath: `config-${guid}.toml`,
    filters: [{ name: "TOML", extensions: ["toml"] }],
  });
  if (!path) return;
  await invoke("export_config", { guid, path });
  await invoke("open_in_explorer", { path });
}

export function isInstalled(d: Device): boolean {
  return (
    !!d.installed_version ||
    Object.values(d.slots).some((v) => typeof v === "string" && v.toLowerCase().includes("vxapo"))
  );
}

export function friendlyError(e: unknown): string {
  const msg = String(e);
  if (/os error 5/i.test(msg)) return t("error.permission");
  return msg;
}

/** 轮询/刷新时避免无变化数据触发整树重渲染 */
export function deviceListsEqual(a: Device[], b: Device[]): boolean {
  return a.length === b.length && a.every((d, i) => JSON.stringify(d) === JSON.stringify(b[i]));
}
