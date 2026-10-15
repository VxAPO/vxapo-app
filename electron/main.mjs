// VxAPO Electron 主进程：src-tauri/src/lib.rs 的 1:1 移植（双模运行：
// 前端 api.ts 优先走 window.vxapo，Tauri 路径保留）。
// 命令语义、错误码（E_*）、提权脚本、进度文件格式均与 Rust 侧逐字对齐。
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { spawn, spawnSync } from "node:child_process";
import { createReadStream } from "node:fs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROGRAM_DATA_ROOT = "C:\\ProgramData\\VxAPO";

// 任务栏/进程名称（dev 下默认会显示 "Electron"）
app.setName("VxAPO");

// 独立 userData：默认的 %APPDATA%\Electron 目录在本机 ACL 损坏（建目录拒绝访问、
// 沙箱授权失败），换到正式命名的 VxAPO 目录，一举绕开坏目录 + 身份正确。
// VXAPO_USER_DATA 可整体重定向（perf bench 等场景需要与主实例隔离 profile/单实例锁）。
app.setPath(
  "userData",
  process.env.VXAPO_USER_DATA ||
    path.join(app.getPath("appData"), "VxAPO"),
);

// ── 错误码（与 Rust 侧一致，前端 friendlyError 按码查 i18n）──
const E_TIMEOUT = "E_TIMEOUT";
const E_ELEVATION = "E_ELEVATION";
const E_SCRIPT = "E_SCRIPT";
const E_OP_FAILED = "E_OP_FAILED";
const E_INSTALL_FAILED = "E_INSTALL_FAILED";
const E_CLI_SPAWN = "E_CLI_SPAWN";
const E_CLI_PARSE = "E_CLI_PARSE";
const E_CLI_WAIT = "E_CLI_WAIT";
const E_INVALID_LANG = "E_INVALID_LANG";
const E_INSTALL_NO_RESULT = "E_INSTALL_NO_RESULT";
const coded = (code, detail) => `${code}: ${detail}`;

const deviceDir = (guid) => path.join(PROGRAM_DATA_ROOT, guid);
const deviceConfigPath = (guid) => path.join(deviceDir(guid), "config.toml");
const langFilePath = () => path.join(PROGRAM_DATA_ROOT, "lang.txt");
const progressPath = (tag) => path.join(os.tmpdir(), `vxapo_${tag}.progress`);

let cliPathMemo = null;
function cliPath() {
  if (cliPathMemo) return cliPathMemo;
  if (process.env.VXAPO_CLI) return (cliPathMemo = process.env.VXAPO_CLI);
  // release：exe 同目录 / resources 子目录（electron-builder extraResources）
  const exeDir = path.dirname(process.execPath);
  for (const p of [
    path.join(exeDir, "vxapo-cli.exe"),
    path.join(exeDir, "resources", "vxapo-cli.exe"),
    path.join(exeDir, "resources", "app", "vxapo-cli.exe"),
  ]) {
    if (fs.existsSync(p)) return (cliPathMemo = p);
  }
  // dev：仓库内 src-tauri/resources 副本
  const devCli = path.join(
    __dirname,
    "..",
    "src-tauri",
    "resources",
    "vxapo-cli.exe",
  );
  if (fs.existsSync(devCli)) return (cliPathMemo = devCli);
  return (cliPathMemo = path.join(exeDir, "vxapo-cli.exe"));
}

function systemUsesDarkMode() {
  const r = spawnSync(
    "reg",
    [
      "query",
      "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize",
      "/v",
      "AppsUseLightTheme",
    ],
    { windowsHide: true, encoding: "utf8" },
  );
  if (r.status === 0 && r.stdout) {
    return r.stdout.includes("0x0") && !r.stdout.includes("0x1");
  }
  return false;
}

function configRevision(buf) {
  // FNV-1a 64（BigInt 版，与 Rust u64 wrap 语义一致）
  let h = 0xcbf29ce484222325n;
  for (const b of buf) {
    h ^= BigInt(b);
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, "0");
}

// ── 提权引擎（VBS runas + 隐藏窗口，与 Rust 侧语义同构）──
// 控制文件（ps1/vbs/err/done/outer/log）带唯一后缀：固定文件名曾与残留的
// 提权 PowerShell 抢同一个 ps1（reset 删不掉被锁的旧文件 → 下次写入 EPERM）。
// progress 文件保留固定名（前端 readProgress 的路径契约）。
class ElevationFiles {
  constructor(tag) {
    const uid = `${Date.now().toString(36)}_${process.pid}`;
    const p = (ext) => path.join(os.tmpdir(), `vxapo_${tag}_${uid}.${ext}`);
    this.ps1 = p("ps1");
    this.vbs = p("vbs");
    this.err = p("err.txt");
    this.done = p("done");
    this.outer = p("outer.txt");
    this.logFile = p("log");
  }
  reset() {
    for (const p of [
      this.ps1,
      this.vbs,
      this.err,
      this.done,
      this.outer,
      this.logFile,
    ]) {
      try {
        fs.unlinkSync(p);
      } catch {
        /* ignore */
      }
    }
  }
  cleanup() {
    for (const p of [this.ps1, this.vbs, this.outer, this.done]) {
      try {
        fs.unlinkSync(p);
      } catch {
        /* ignore */
      }
    }
  }
  log(m) {
    try {
      fs.writeFileSync(this.logFile, m + "\n");
    } catch {
      /* ignore */
    }
  }
  stderr() {
    try {
      return fs.readFileSync(this.err, "utf8").trim();
    } catch {
      return "";
    }
  }
  exitCode() {
    try {
      const t = fs.readFileSync(this.done, "utf8").replace(/^﻿/, "").trim();
      if (!t) return null;
      const n = Number.parseInt(t, 10);
      return Number.isFinite(n) ? n : 1;
    } catch {
      return null;
    }
  }
  failOr(code) {
    const msg = this.stderr();
    return msg === "" ? code : msg;
  }
}

const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";

function buildElevationScripts(cli, args, f, stdoutTo) {
  const stdout = stdoutTo ? q(stdoutTo) : "$null";
  const inner =
    `& ${q(cli)} ${args.map(q).join(" ")} 1> ${stdout} 2> ${q(f.err)}; ` +
    `$code = $LASTEXITCODE; [System.IO.File]::WriteAllText(${q(f.done)}, "$code"); exit $code`;
  fs.writeFileSync(f.ps1, inner);
  const vbs =
    'On Error Resume Next\r\nSet s = CreateObject("Shell.Application")\r\n' +
    `r = s.ShellExecute("powershell.exe", "-NoProfile -ExecutionPolicy Bypass -File ${f.ps1}", "", "runas", 0)\r\n` +
    'If r <= 32 Then\r\n  Set fso = CreateObject("Scripting.FileSystemObject")\r\n' +
    `  fso.CreateTextFile("${f.outer}", True).Write CStr(r)\r\nEnd If`;
  fs.writeFileSync(f.vbs, vbs);
}

function spawnElevation(f) {
  try {
    spawn("wscript.exe", [f.vbs], {
      windowsHide: true,
      stdio: "ignore",
    }).unref();
  } catch (e) {
    f.log(`spawn-error: ${e.message}`);
    throw coded(E_ELEVATION, e.message);
  }
}

async function pollCompletion(f, timeoutMs, pollMs, onTick) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    onTick?.();
    const code = f.exitCode();
    if (code !== null) return { kind: "done", code };
    const msg = f.stderr();
    if (msg) {
      f.log(`err: ${msg}`);
      return { kind: "failed", msg };
    }
    let outer = "";
    try {
      outer = fs.readFileSync(f.outer, "utf8");
    } catch {
      /* ignore */
    }
    if (outer.trim()) {
      f.log(`outer-err: ${outer.trim()}`);
      return { kind: "failed", msg: outer.trim() };
    }
    if (Date.now() >= deadline) {
      f.log("timeout");
      return { kind: "timeout" };
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

async function runCliElevated(cli, args, tag) {
  const f = new ElevationFiles(tag);
  const progress = progressPath(tag);
  f.reset();
  try {
    fs.unlinkSync(progress);
  } catch {
    /* ignore */
  }
  f.log("start");
  buildElevationScripts(cli, args, f, progress);
  spawnElevation(f);
  f.log("spawned");
  const outcome = await pollCompletion(f, 90_000, 300);
  if (outcome.kind === "done" && outcome.code === 0) {
    f.log("done-ok");
    let out = "";
    try {
      out = fs.readFileSync(progress, "utf8");
    } catch {
      /* ignore */
    }
    try {
      fs.unlinkSync(f.logFile);
    } catch {
      /* ignore */
    }
    try {
      fs.unlinkSync(progress);
    } catch {
      /* ignore */
    }
    try {
      fs.unlinkSync(f.err);
    } catch {
      /* ignore */
    }
    f.cleanup();
    return out.trim();
  }
  if (outcome.kind === "done") {
    f.log(`done-fail:${outcome.code}`);
    const msg = f.failOr(E_OP_FAILED);
    f.cleanup();
    throw new Error(msg);
  }
  if (outcome.kind === "failed") {
    f.cleanup();
    throw new Error(outcome.msg);
  }
  f.cleanup();
  throw new Error(E_TIMEOUT);
}

async function runCliElevatedStream(cli, args, tag, onEvent) {
  const f = new ElevationFiles(tag);
  const progress = progressPath(tag);
  f.reset();
  try {
    fs.unlinkSync(progress);
  } catch {
    /* ignore */
  }
  f.log("stream-start");
  buildElevationScripts(cli, args, f, null);
  spawnElevation(f);
  f.log("stream-spawned");
  let offset = 0;
  const drain = () => {
    // 增量读取：只推进到最后一个完整行（含换行），避免切半行丢事件
    let s;
    try {
      const stat = fs.statSync(progress);
      if (stat.size <= offset) return;
      const fd = fs.openSync(progress, "r");
      const len = stat.size - offset;
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, offset);
      fs.closeSync(fd);
      s = buf.toString("utf8");
    } catch {
      return;
    }
    const lastNl = s.lastIndexOf("\n");
    if (lastNl < 0) return;
    const full = s.slice(0, lastNl + 1);
    offset += Buffer.byteLength(full, "utf8");
    for (const line of full.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        onEvent(JSON.parse(line));
      } catch {
        /* ignore */
      }
    }
  };
  const outcome = await pollCompletion(f, 300_000, 200, drain);
  drain();
  const msg = f.stderr();
  f.log(`stream-done:${outcome.kind === "done" ? outcome.code : outcome.kind}`);
  f.cleanup();
  if (outcome.kind === "done") {
    if (outcome.code === 0) {
      try {
        fs.unlinkSync(f.logFile);
      } catch {
        /* ignore */
      }
      try {
        fs.unlinkSync(f.err);
      } catch {
        /* ignore */
      }
      return msg;
    }
    throw new Error(msg === "" ? E_INSTALL_FAILED : msg);
  }
  if (outcome.kind === "failed") throw new Error(outcome.msg);
  throw new Error(E_TIMEOUT);
}

async function runCli(cli, args, tag) {
  // 优先直连（无权限时不弹窗）；仅在「需要管理员权限」时降级隐藏提权
  const r = await new Promise((resolve) => {
    const ch = spawn(cli, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    ch.stdout.on("data", (d) => (out += d));
    ch.stderr.on("data", (d) => (err += d));
    ch.on("error", (e) => resolve({ spawnErr: e }));
    ch.on("close", (code) => resolve({ code, out, err }));
  });
  if (r.spawnErr) throw coded(E_CLI_SPAWN, r.spawnErr.message);
  const out = r.out.trim();
  const err = r.err.trim();
  if (r.code === 0) return out;
  const msg = err === "" ? out : err;
  if (
    msg.includes("需要管理员权限") ||
    msg.toLowerCase().includes("administrator privileges")
  ) {
    return runCliElevated(cli, args, tag);
  }
  throw new Error(msg === "" ? "CLI 执行失败" : msg);
}

async function runCliWithEvents(cli, args, tag, onEvent) {
  const ch = spawn(cli, args, {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  let err = "";
  ch.stderr.on("data", (d) => (err += d));
  const rl = readline.createInterface({ input: ch.stdout });
  for await (const line of rl) {
    out += line + "\n";
    try {
      onEvent(JSON.parse(line));
    } catch {
      /* ignore */
    }
  }
  const code = await new Promise((resolve) => ch.on("close", resolve));
  const outTrim = out.trim();
  const errTrim = err.trim();
  if (code === 0) return outTrim;
  const msg = errTrim === "" ? outTrim : errTrim;
  if (
    msg.includes("需要管理员权限") ||
    msg.toLowerCase().includes("administrator privileges")
  ) {
    return runCliElevatedStream(cli, args, tag, onEvent);
  }
  throw new Error(msg);
}

// ── IPC 命令（与 lib.rs 同名同语义）──
function registerIpc(win) {
  const h = (name, fn) => ipcMain.handle(name, (_e, args = {}) => fn(args));
  h("write_config", ({ guid, content }) => {
    fs.mkdirSync(deviceDir(guid), { recursive: true });
    const tmp = path.join(deviceDir(guid), "config.toml.tmp");
    fs.writeFileSync(tmp, content, "utf8");
    fs.renameSync(tmp, deviceConfigPath(guid));
  });
  h("read_config", ({ guid }) => {
    try {
      return fs.readFileSync(deviceConfigPath(guid), "utf8");
    } catch (e) {
      if (e.code === "ENOENT") return "";
      throw e.message;
    }
  });
  h("read_config_checked", ({ guid, knownRevision }) => {
    let bytes;
    try {
      bytes = fs.readFileSync(deviceConfigPath(guid));
    } catch (e) {
      if (e.code === "ENOENT") bytes = Buffer.alloc(0);
      else throw e.message;
    }
    const revision = configRevision(bytes);
    if (knownRevision != null && knownRevision === revision)
      return { revision, text: null };
    return { revision, text: bytes.toString("utf8") };
  });
  h("read_import_file", ({ path: p }) => fs.readFileSync(p, "utf8"));
  h("read_lang", () => {
    const candidates = [
      langFilePath(),
      path.join(path.dirname(process.execPath), "lang.txt"),
    ];
    for (const p of candidates) {
      try {
        const s = fs.readFileSync(p, "utf8");
        const v = s.trim();
        if (v === "zh" || v === "en") return v;
        return "";
      } catch {
        /* try next */
      }
    }
    return "";
  });
  h("write_lang", ({ lang }) => {
    if (lang !== "zh" && lang !== "en") throw E_INVALID_LANG;
    fs.mkdirSync(PROGRAM_DATA_ROOT, { recursive: true });
    fs.writeFileSync(langFilePath(), lang, "utf8");
  });
  h("show_main_window", () => {
    if (win && !win.isDestroyed()) {
      if (!win.isVisible()) win.show();
      if (!win.isMaximized()) win.maximize();
    }
  });
  h("export_config", async ({ guid, path: p }) => {
    // api.ts 在 Electron 分支自行弹保存框后传路径进来
    const content = fs.readFileSync(deviceConfigPath(guid), "utf8");
    fs.writeFileSync(p, content, "utf8");
  });
  h("save_dialog", async (opts = {}) => {
    const r = await dialog.showSaveDialog(win, {
      title: opts.title,
      defaultPath: opts.defaultPath,
      filters: opts.filters,
    });
    return r.canceled ? null : r.filePath;
  });
  h("open_in_explorer", ({ path: p }) => shell.showItemInFolder(p));
  h("list_devices", async () => {
    const out = await runCli(cliPath(), ["list", "--json"], "list");
    try {
      return JSON.parse(out);
    } catch {
      throw coded(E_CLI_PARSE, out.slice(0, 200));
    }
  });
  h("list_stale_installs", async () => {
    const out = await runCli(
      cliPath(),
      ["stale", "list", "--json"],
      "stale_list",
    );
    try {
      return JSON.parse(out);
    } catch {
      throw coded(E_CLI_PARSE, out.slice(0, 200));
    }
  });
  h("uninstall_device", ({ guid }) => {
    const tag = "uninstall_" + guid.replace(/[{}]/g, "");
    return runCli(cliPath(), ["uninstall", "-d", guid], tag);
  });
  h("rollback_install", ({ guid }) => {
    const tag = "rollback_" + guid.replace(/[{}]/g, "");
    return runCli(cliPath(), ["uninstall", "-d", guid], tag);
  });
  h("migrate_stale_install", ({ from, to, configFrom, snapshotFrom }) => {
    const tag = "stale_migrate_" + from.replace(/[{}]/g, "");
    const args = ["stale", "migrate", "--from", from, "--to", to, "--json"];
    if (configFrom != null) args.push("--config-from", configFrom);
    if (snapshotFrom != null) args.push("--snapshot-from", snapshotFrom);
    return runCli(cliPath(), args, tag);
  });
  h("cleanup_stale_install", ({ guid }) => {
    const tag = "stale_cleanup_" + guid.replace(/[{}]/g, "");
    return runCli(cliPath(), ["stale", "cleanup", "-d", guid, "--json"], tag);
  });
  h("repair_stale_acl", ({ guid }) => {
    const tag = "stale_fix_acl_" + guid.replace(/[{}]/g, "");
    return runCli(cliPath(), ["stale", "fix-acl", "-d", guid, "--json"], tag);
  });
  h("read_progress", ({ tag }) => {
    try {
      return fs.readFileSync(progressPath(tag), "utf8");
    } catch {
      return "";
    }
  });
  // ── 窗口控制（对应 useWindowControls 的 Tauri API）──
  h("win_minimize", () => win?.minimize());
  h("win_toggle_maximize", () => {
    if (!win) return false;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
    return win.isMaximized();
  });
  h("win_is_maximized", () => !!win?.isMaximized());
  h("win_close", () => win?.close());
  win.on("maximize", () => win.webContents.send("win-max-state", true));
  win.on("unmaximize", () => win.webContents.send("win-max-state", false));
  h("install_device", async ({ guid }) => {
    const tag = "install_" + guid.replace(/[{}]/g, "");
    const prog = progressPath(tag);
    const args = ["install", "-d", guid, "--verify", "--progress-file", prog];
    let lastComplete = null;
    const onEvent = (ev) => {
      if (ev.event === "complete") lastComplete = ev;
      win.webContents.send("install-progress", ev);
    };
    let resultErr = null;
    try {
      await runCliWithEvents(cliPath(), args, tag, onEvent);
    } catch (e) {
      resultErr = e;
    }
    if (lastComplete) {
      // 成功清进度文件；失败保留供诊断（与 Rust 一致）
      if (lastComplete.success) {
        try {
          fs.unlinkSync(prog);
        } catch {
          /* ignore */
        }
      }
      const v = lastComplete;
      return {
        success: !!v.success,
        mode: v.mode ?? null,
        score: v.score ?? null,
        attempts: v.attempts ?? 0,
        bestMode: v.best_mode ?? null,
        bestScore: v.best_score ?? null,
      };
    }
    let tail = "";
    try {
      tail = fs
        .readFileSync(prog, "utf8")
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(-12)
        .join("\n");
    } catch {
      /* ignore */
    }
    const msg = resultErr
      ? String(resultErr?.message ?? resultErr)
      : coded(E_INSTALL_NO_RESULT, "");
    throw new Error(tail === "" ? msg : `${msg}\n--- 进度尾部 ---\n${tail}`);
  });
}

// ── 窗口 ──
// 默认形态 = DWM 带框路径（平滑）+ titleBarStyle hidden（标题栏本体隐藏，窗口
// 控件用应用内按钮）。无边框窗口在本机会掉出 DWM 的 vsync 调度阶梯（滚动卡顿），
// --borderless 仅作对照实验保留。注意：带框路径自带约 1px 系统细边框，无法去除
// ——它就是「上平滑呈现路径」的载体。
let mainWindow = null;
function createWindow() {
  const dark = systemUsesDarkMode();
  const borderless =
    process.env.ELECTRON_BORDERLESS === "1" ||
    process.argv.includes("--borderless");
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    minWidth: 800,
    minHeight: 600,
    frame: !borderless,
    ...(borderless ? {} : { titleBarStyle: "hidden" }),
    show: false,
    backgroundColor: dark ? "#16181b" : "#f0f3f6",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  registerIpc(mainWindow);
  // 任务栏/窗口标题固定 VxAPO：网页 <title>（已改）与任何页面内的 title 更新都不得覆盖
  mainWindow.on("page-title-updated", (e) => e.preventDefault());
  mainWindow.setTitle("VxAPO");
  mainWindow.webContents.on("did-finish-load", () => {
    // 与 Tauri show_main_window 同款：内容就绪后再显示，防白屏一闪
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.maximize();
  });
  const devUrl = "http://localhost:1420";
  if (!app.isPackaged) {
    mainWindow.loadURL(devUrl).catch(() => {
      mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
    });
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

async function ensureVite() {
  if (app.isPackaged) return;
  try {
    await fetch("http://localhost:1420/");
    return; // 已有 dev server（比如 tauri dev 在跑）
  } catch {
    /* start one */
  }
  // Windows 下 npm 是 npm.cmd，裸 spawn 会 ENOENT——走 shell
  const child = spawn(
    process.platform === "win32" ? "npm.cmd" : "npm",
    ["run", "dev"],
    {
      cwd: path.join(__dirname, ".."),
      windowsHide: true,
      stdio: "ignore",
      shell: process.platform === "win32",
    },
  );
  child.on("error", () => {
    /* 起不来就走 dist 兜底 */
  });
  child.unref();
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      await fetch("http://localhost:1420/");
      return;
    } catch {
      /* retry */
    }
  }
}

// CDP 便于验证：ELECTRON_CDP_PORT=9223 npx electron ...
const cdpPort = process.env.ELECTRON_CDP_PORT;
if (cdpPort) app.commandLine.appendSwitch("remote-debugging-port", cdpPort);

// 单实例锁：重复启动不再硬拉第二个进程（提权通道对二次拉起不友好），
// 而是唤起已有窗口。
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    await ensureVite();
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
