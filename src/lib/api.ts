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

// 进度事件取自 CLI 契约（vxapo-cli/protocol 生成，见 lib/generated/index.ts）。
import type { InstallProgressEvent } from "./generated";

export type { InstallProgressEvent } from "./generated";

/** 安装结果 = 进度流里 `complete` 事件的载荷（src-tauri 取进度文件最后一行）。 */
export type InstallResult = Extract<InstallProgressEvent, { event: "complete" }>;

export async function installDevice(guid: string): Promise<InstallResult> {
  if (!isTauri) return { event: "complete", success: false, attempts: 0 };
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

/** Rust 侧结构化错误码（lib.rs 的 `E_*`）→ i18n 键；未知码回落到 error.operation。 */
const ERROR_KEYS: Record<string, string> = {
  E_TIMEOUT: "error.timeout",
  E_ELEVATION: "error.elevation",
  E_SCRIPT: "error.script",
  E_CLI_SPAWN: "error.cliSpawn",
  E_CLI_PARSE: "error.cliParse",
  E_CLI_WAIT: "error.cliWait",
  E_OP_FAILED: "error.operation",
  E_INSTALL_FAILED: "error.install",
  E_INSTALL_THREAD: "error.installThread",
  E_INSTALL_NO_RESULT: "error.installNoResult",
  E_INVALID_LANG: "error.lang",
};

/**
 * 把后端错误转成给用户看的文案。
 *
 * Rust 侧只传错误码（`E_Xxx`，可带 `: 详情`）；码走 i18n，详情（OS 错误码、CLI 输出片段）
 * 原样附在后面供排障。CLI 自己写出的错误文本不含码，按原文透传。
 */
export function friendlyError(e: unknown): string {
  const msg = String(e);
  const m = /^(E_[A-Z_]+)(?::\s*([\s\S]+))?$/.exec(msg.trim());
  if (m) {
    const base = t(ERROR_KEYS[m[1]] ?? "error.operation");
    return m[2] ? `${base}：${m[2]}` : base;
  }
  if (/os error 5/i.test(msg)) return t("error.permission");
  return msg;
}

/** 轮询/刷新时避免无变化数据触发整树重渲染 */
export function deviceListsEqual(a: Device[], b: Device[]): boolean {
  return a.length === b.length && a.every((d, i) => JSON.stringify(d) === JSON.stringify(b[i]));
}
