// 旧 GUID 残留的"可自动修复"筛选（App 启动自动修复用）。
//
// 判据本身在 driver（`StaleInstall.auto_repairable`，单一事实源）：
// 目标唯一命中 + 旧记录配置有意义 + 目标目录没有有意义的配置。
// 这里只做防御性过滤（必须带目标）与排序（源配置越新越先恢复）。
import type { StaleInstall } from "./model";

/** 自动修复候选（按源配置 mtime 从新到旧）。 */
export function pickAutoRepairTargets(items: StaleInstall[]): StaleInstall[] {
  return items
    .filter((s) => s.auto_repairable && !!s.target_guid)
    .sort((a, b) => (b.config_mtime_ms ?? 0) - (a.config_mtime_ms ?? 0));
}

/**
 * 这次失败是否属于「再试只会更糟」的**提权类**失败。
 *
 * 自动修复走提权 CLI：提权被拒（UAC 取消、ShellExecute 失败）、提权脚本超时，
 * 都意味着后面每一条都会再弹一次 UAC 或再等满一次超时。这类失败要整轮放弃，
 * 交给顶部横幅手动处理；其余失败（端点正在重新枚举、单台记录已失效等）只是
 * 这一台没成，不影响其它设备，必须继续。
 *
 * 判据只看结构化错误码与 CLI 原文，不做本地化文案匹配。
 */
export function isElevationFailure(e: unknown): boolean {
  const s = String(e).trim();
  // Rust/Electron 两侧的结构化码（见 api.ts 的 ERROR_KEYS）：
  // E_ELEVATION = 拉起提权进程失败，E_TIMEOUT = 提权脚本 90s/300s 没出结果，
  // E_SCRIPT = 提权脚本本身没写成。三者都不是单台设备的问题。
  if (/\bE_(ELEVATION|TIMEOUT|SCRIPT)\b/.test(s)) return true;
  // 提权前的直连判定：CLI 自己报的权限不足（中英两版）。
  if (s.includes("需要管理员权限")) return true;
  if (/administrator privileges/i.test(s)) return true;
  // 裸数字 = ShellExecute 返回码（两个引擎都只在「提权进程根本没拉起来」时
  // 把它写进 .outer，最常见的就是用户在 UAC 上点了取消 → 1223 / 5）。
  // CLI 失败走的是 .done 退出码，此时带的是 E_OP_FAILED 或 CLI 原文，不会是裸数字。
  if (/^\d+$/.test(s)) return true;
  return false;
}
