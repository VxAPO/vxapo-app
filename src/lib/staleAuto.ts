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
