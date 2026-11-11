// 启动自动修复（旧 GUID 迁移）的候选筛选与失败分类。
//
// 回归点：GUID 迁移是**按设备**各自触发的，一次 Windows 更新可能同时让多台设备
// 换 GUID。旧实现「任一失败即 break」会让第一台的失败吞掉后面所有设备，
// 现象就是「只有一台被迁移」。
import { describe, expect, it } from "vitest";
import { isElevationFailure, pickAutoRepairTargets } from "./staleAuto";
import type { StaleInstall } from "./model";

function stale(over: Partial<StaleInstall> = {}): StaleInstall {
  return {
    guid: "{11111111-1111-1111-1111-111111111111}",
    device_instance_id: "USB\\VID_0000&PID_0000\\1",
    display_name: "Dev",
    matched_by: "endpoint_history",
    config_path: null,
    config_mtime_ms: 0,
    snapshot_path: null,
    snapshot_mtime_ms: 0,
    premix_slot: null,
    postmix_slot: null,
    inferred_mode: "SfxEfx",
    has_child_backup: false,
    has_sysfx_backup: false,
    target_guid: "{22222222-2222-2222-2222-222222222222}",
    target_name: "Dev",
    target_state: "matched_partial",
    auto_repairable: true,
    ...over,
  };
}

describe("pickAutoRepairTargets", () => {
  it("只取可自动修复且带目标的记录，源配置越新越先", () => {
    const items = [
      stale({ guid: "{A}", config_mtime_ms: 100 }),
      stale({ guid: "{B}", config_mtime_ms: 300 }),
      stale({ guid: "{C}", config_mtime_ms: 200 }),
      stale({ guid: "{D}", auto_repairable: false, config_mtime_ms: 999 }),
      stale({ guid: "{E}", target_guid: null, config_mtime_ms: 999 }),
    ];
    expect(pickAutoRepairTargets(items).map((s) => s.guid)).toEqual([
      "{B}",
      "{C}",
      "{A}",
    ]);
  });

  it("多台设备都保留（不因同一目标或相邻位置被裁掉）", () => {
    const items = [
      stale({ guid: "{A}", target_guid: "{T1}" }),
      stale({ guid: "{B}", target_guid: "{T2}" }),
      stale({ guid: "{C}", target_guid: "{T3}" }),
    ];
    expect(pickAutoRepairTargets(items)).toHaveLength(3);
  });
});

describe("isElevationFailure", () => {
  it("提权类失败：结构化码与 CLI 原文都认", () => {
    for (const msg of [
      "E_ELEVATION: ShellExecute 失败",
      "E_TIMEOUT",
      "E_SCRIPT: 写提权脚本失败",
      "需要管理员权限（写入 HKLM）。请以管理员身份运行 CLI",
      "Administrator privileges required (write to HKLM).",
    ]) {
      expect(isElevationFailure(msg), msg).toBe(true);
    }
  });

  it("UAC 取消：ShellExecute 裸返回码按提权失败处理（1223/5）", () => {
    // 提权引擎在「提权进程没拉起来」时把裸返回码写进 .outer 并原样上报。
    expect(isElevationFailure("1223")).toBe(true);
    expect(isElevationFailure(" 5 ")).toBe(true);
  });

  it("非提权类失败：只是这一台没成，必须继续后面的设备", () => {
    for (const msg of [
      "未找到旧安装记录：{AAAA}",
      "旧 GUID {A} 与目标端点 {B} 不是同一设备，拒绝迁移",
      "迁移后目标端点的 VxAPO 安装状态仍不完整（version / Child APOs 缺失）",
      "设备不存在：{BBBB}",
      "E_CLI_SPAWN: spawn failed",
      "TypeError: boom",
    ]) {
      expect(isElevationFailure(msg), msg).toBe(false);
    }
  });

  it("Error 实例取其 message", () => {
    expect(isElevationFailure(new Error("E_TIMEOUT"))).toBe(true);
    expect(isElevationFailure(new Error("未找到旧安装记录：{A}"))).toBe(false);
  });
});
