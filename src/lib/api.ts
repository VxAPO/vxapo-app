// VxAPO App — Tauri 命令封装（UI 设计规范 05：文件系统 + CLI --json）

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Device, MigrationReport, StaleInstall } from "./model";
import { t } from "./i18n/core";

const isTauri =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
/**
 * Electron 双模：主进程 preload 暴露 window.vxapo（invoke/listen，语义与
 * Tauri invoke 1:1）。存在即优先走 Electron 桥，否则回退 Tauri，最后兜底值。
 */
const isElectron =
  typeof window !== "undefined" &&
  "vxapo" in window &&
  typeof (window as unknown as { vxapo?: { invoke?: unknown } }).vxapo
    ?.invoke === "function";

type VxapoBridge = {
  invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
  listen: (channel: string, cb: (payload: unknown) => void) => () => void;
};
const vxapo = (): VxapoBridge =>
  (window as unknown as { vxapo: VxapoBridge }).vxapo;

/**
 * 非 Tauri 环境（浏览器直开 / vitest）的统一降级入口：跳过 IPC 返回兜底值。
 * 之前每个 API 各自开头写一遍 `if (!isTauri) return …`，收敛到这里一处。
 */
async function invokeOrDefault<T>(
  cmd: string,
  args: Record<string, unknown> | undefined,
  fallback: T,
): Promise<T> {
  if (isElectron) {
    try {
      return await vxapo().invoke<T>(cmd, args ?? {});
    } catch (e) {
      // 与 Tauri 的拒绝形态对齐：抛纯字符串（friendlyError 按 E_* 码解析）
      throw e instanceof Error ? e.message : String(e);
    }
  }
  if (!isTauri) return fallback;
  return args === undefined ? invoke<T>(cmd) : invoke<T>(cmd, args);
}

export async function readConfig(guid: string): Promise<string> {
  return invokeOrDefault("read_config", { guid }, "");
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
  return invokeOrDefault("read_config_checked", { guid, knownRevision }, null);
}

/** 读取界面语言（"zh" / "en"；无记录返回空串）。 */
export async function readLang(): Promise<string> {
  return invokeOrDefault("read_lang", undefined, "");
}

/** 写入界面语言（设置里切换时调用，与安装器共用 lang.txt）。 */
export async function writeLang(lang: string): Promise<void> {
  try {
    await invokeOrDefault("write_lang", { lang }, undefined);
  } catch {
    /* 尽力而为：写失败时本次会话仍生效 */
  }
}

export async function writeConfig(
  guid: string,
  content: string,
): Promise<void> {
  await invokeOrDefault("write_config", { guid, content }, undefined);
}

export async function listDevices(): Promise<Device[]> {
  return invokeOrDefault("list_devices", undefined, []);
}

export async function uninstallDevice(guid: string): Promise<void> {
  await invokeOrDefault("uninstall_device", { guid }, undefined);
}

/** 旧 GUID 残留列表（只读）。 */
export async function listStaleInstalls(): Promise<StaleInstall[]> {
  return invokeOrDefault("list_stale_installs", undefined, []);
}

/** 迁移旧 GUID 到当前端点（需要管理员，Tauri 侧自动提权）。 */
export async function migrateStaleInstall(
  from: string,
  to: string,
  configFrom?: string | null,
  snapshotFrom?: string | null,
): Promise<MigrationReport | null> {
  const raw = await invokeOrDefault<string>(
    "migrate_stale_install",
    {
      from,
      to,
      configFrom: configFrom ?? null,
      snapshotFrom: snapshotFrom ?? null,
    },
    "",
  );
  const line = raw.trim().split("\n").filter(Boolean).pop() ?? "";
  return line ? (JSON.parse(line) as MigrationReport) : null;
}

/** 清理无法匹配活跃端点的旧 GUID 残留。 */
export async function cleanupStaleInstall(guid: string): Promise<void> {
  await invokeOrDefault("cleanup_stale_install", { guid }, undefined);
}

/** 修复迁移后 config 的用户 ACL（权限不足时一次性提权修复）。 */
export async function repairStaleAcl(guid: string): Promise<void> {
  await invokeOrDefault("repair_stale_acl", { guid }, undefined);
}

// 进度事件取自 CLI 契约（vxapo-cli/protocol 生成，见 lib/generated/index.ts）。
import type { InstallProgressEvent } from "./generated";

export type { InstallProgressEvent } from "./generated";

/** 安装结果 = 进度流里 `complete` 事件的载荷（src-tauri 取进度文件最后一行）。 */
export type InstallResult = Extract<
  InstallProgressEvent,
  { event: "complete" }
>;

export async function installDevice(guid: string): Promise<InstallResult> {
  return invokeOrDefault(
    "install_device",
    { guid },
    { event: "complete", success: false, attempts: 0 },
  );
}

/** 安装失败后的兜底回滚：清除已写入的注册表配置（CLI uninstall，提权）。 */
export async function rollbackInstall(guid: string): Promise<void> {
  await invokeOrDefault("rollback_install", { guid }, undefined);
}

export async function onInstallProgress(
  cb: (ev: InstallProgressEvent) => void,
): Promise<() => void> {
  if (isElectron) {
    return vxapo().listen("install-progress", (payload) =>
      cb(payload as InstallProgressEvent),
    );
  }
  if (!isTauri) return () => {};
  return listen<InstallProgressEvent>("install-progress", (e) => cb(e.payload));
}

export async function readProgress(tag: string): Promise<string> {
  return invokeOrDefault("read_progress", { tag }, "");
}

/** 读取拖拽导入文件内容（Tauri 文件拖放事件路径）。 */
export async function readImportFile(path: string): Promise<string> {
  return invokeOrDefault("read_import_file", { path }, "");
}

/** 导出当前设备 config.toml 到用户选择的路径，并在资源管理器中选中。 */
export async function exportConfig(guid: string): Promise<void> {
  const opts = {
    title: t("export.title"),
    defaultPath: `config-${guid}.toml`,
    filters: [{ name: "TOML", extensions: ["toml"] }],
  };
  if (isElectron) {
    const path = await vxapo().invoke<string | null>("save_dialog", opts);
    if (!path) return;
    await invokeOrDefault("export_config", { guid, path }, undefined);
    await invokeOrDefault("open_in_explorer", { path }, undefined);
    return;
  }
  if (!isTauri) return;
  const { save } = await import("@tauri-apps/plugin-dialog");
  const path = await save(opts);
  if (!path) return;
  await invoke("export_config", { guid, path });
  await invoke("open_in_explorer", { path });
}

export function isInstalled(d: Device): boolean {
  return (
    !!d.installed_version ||
    Object.values(d.slots).some(
      (v) => typeof v === "string" && v.toLowerCase().includes("vxapo"),
    )
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
  return (
    a.length === b.length &&
    a.every((d, i) => JSON.stringify(d) === JSON.stringify(b[i]))
  );
}
