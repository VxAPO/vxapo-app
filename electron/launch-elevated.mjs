// 以管理员身份启动 Electron（本机 UAC 为「静默提权」配置，通常无弹窗）。
// 为什么不能直接 spawn：electron.exe 已嵌入 requireAdministrator manifest，
// 非提权进程 CreateProcess 会返回 740（Node 表现为 EACCES）。
// 三级启动链：
//   1) VBS → Shell.Application.ShellExecute runas（带真实错误透出：Err.Number/Description）
//   2) PowerShell Start-Process -Verb RunAs（同 consent 基础设施、不同调用方，偶发故障可互补）
//   3) 直接 spawn（仅当当前上下文本就已提权时可用）
// 用法：node electron/launch-elevated.mjs [--borderless]
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const exe = path.join(
  __dirname,
  "..",
  "node_modules",
  "electron",
  "dist",
  "electron.exe",
);
const appDir = path.join(__dirname, "..");
const main = path.join(__dirname, "main.mjs");
const borderless = process.argv.includes("--borderless");

if (!fs.existsSync(exe)) {
  console.error("找不到 electron.exe（node_modules/electron/dist）");
  process.exit(1);
}

const uid = `${Date.now().toString(36)}_${process.pid}`;
// VBS 字符串用双引号（单引号是注释符），内部转义为 ""
const q = (s) => '"' + String(s).replace(/"/g, '""') + '"';
const argList = borderless
  ? ["--no-sandbox", "--borderless", main]
  : ["--no-sandbox", main];
const params = argList.join(" ");

// ── 通道 1：VBS ShellExecute runas（失败时写入真实 Err 信息）──
function tryVbs() {
  const vbs = path.join(os.tmpdir(), `vxapo_launch_${uid}.vbs`);
  const outer = path.join(os.tmpdir(), `vxapo_launch_${uid}.outer`);
  fs.writeFileSync(
    vbs,
    'Set s = CreateObject("Shell.Application")\r\n' +
      "On Error Resume Next\r\n" +
      "Err.Clear\r\n" +
      `r = s.ShellExecute(${q(exe)}, ${q(params)}, ${q(appDir)}, "runas", 0)\r\n` +
      "If Err.Number <> 0 Then\r\n" +
      `  CreateObject("Scripting.FileSystemObject").CreateTextFile(${q(outer)}, True).Write "ERR:0x" & Hex(Err.Number) & " " & Err.Description\r\n` +
      "Else\r\n" +
      "  If r <= 32 Then\r\n" +
      `    CreateObject("Scripting.FileSystemObject").CreateTextFile(${q(outer)}, True).Write "CODE:" & CStr(r)\r\n` +
      "  End If\r\n" +
      "End If",
  );
  spawn("wscript.exe", [vbs], { windowsHide: true, stdio: "ignore" }).unref();
  const t0 = Date.now();
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      if (fs.existsSync(outer)) {
        clearInterval(timer);
        const detail = fs.readFileSync(outer, "utf8").trim() || "(空)";
        try {
          fs.unlinkSync(outer);
        } catch {
          /* ignore */
        }
        try {
          fs.unlinkSync(vbs);
        } catch {
          /* ignore */
        }
        resolve(detail);
      } else if (Date.now() - t0 > 12000) {
        clearInterval(timer);
        try {
          fs.unlinkSync(vbs);
        } catch {
          /* ignore */
        }
        resolve(null); // 无失败信号 = 成功
      }
    }, 300);
  });
}

// ── 通道 2：PowerShell Start-Process -Verb RunAs ──
function tryPowerShell() {
  const psArgList = argList.map((a) => `'${a.replace(/'/g, "''")}'`).join(",");
  const cmd =
    `try { Start-Process -FilePath '${exe.replace(/'/g, "''")}' ` +
    `-ArgumentList ${psArgList} -WorkingDirectory '${appDir.replace(/'/g, "''")}' ` +
    `-Verb RunAs -ErrorAction Stop; exit 0 } ` +
    `catch { [Console]::Error.WriteLine($_.Exception.Message); exit 1 }`;
  const r = spawnSync("powershell.exe", ["-NoProfile", "-Command", cmd], {
    windowsHide: true,
    encoding: "utf8",
    timeout: 30000,
  });
  if (r.status === 0) return null;
  return (r.stderr || "").trim() || `exit=${r.status}`;
}

// ── 通道 3：直接 spawn（仅当前上下文已提权时可用）──
function tryDirect() {
  const r = spawnSync(exe, argList, { windowsHide: true, timeout: 3000 });
  // spawn 成功即返回（electron 常驻，timeout 杀掉即可）；EACCES/740 = 未提权被拦
  if (r.error) return `${r.error.code ?? r.error.message}`;
  return null; // 真跑起来了
}

const e1 = await tryVbs();
if (e1 === null) process.exit(0); // 通道 1 成功
console.error(`[1/3] ShellExecute runas 失败：${e1}`);

const e2 = tryPowerShell();
if (e2 === null) {
  console.error("[2/3] PowerShell Start-Process 提权启动成功");
  process.exit(0);
}
console.error(`[2/3] Start-Process runas 失败：${e2}`);

const e3 = tryDirect();
if (e3 === null) process.exit(0);
console.error(
  `[3/3] 直接启动失败：${e3}（requireAdministrator manifest 要求提权）`,
);
console.error(
  "三条通道全灭：系统的提权/consent 基础设施异常，或当前账户不是管理员。",
);
process.exit(1);
