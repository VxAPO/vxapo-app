// VxAPO App — Tauri 命令封装（UI 设计规范 05：文件系统 + CLI --json）

import { invoke } from "@tauri-apps/api/core";
import type { Device } from "./model";

const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function readConfig(guid: string): Promise<string> {
  if (!isTauri) return "";
  return invoke<string>("read_config", { guid });
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

export async function installDevice(guid: string): Promise<void> {
  if (!isTauri) return;
  await invoke("install_device", { guid });
}

export async function readProgress(tag: string): Promise<string> {
  if (!isTauri) return "";
  return invoke<string>("read_progress", { tag });
}

export function isInstalled(d: Device): boolean {
  return (
    !!d.installed_version ||
    Object.values(d.slots).some((v) => typeof v === "string" && v.toLowerCase().includes("vxapo"))
  );
}

export function friendlyError(e: unknown): string {
  const msg = String(e);
  if (/os error 5/i.test(msg)) return "权限不足，无法读写配置（请以管理员身份运行一次以修复权限）";
  return msg;
}

/** 轮询/刷新时避免无变化数据触发整树重渲染 */
export function deviceListsEqual(a: Device[], b: Device[]): boolean {
  return a.length === b.length && a.every((d, i) => JSON.stringify(d) === JSON.stringify(b[i]));
}
