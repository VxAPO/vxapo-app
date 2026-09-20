use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::OnceLock;
use tauri::Manager;
use tauri::Emitter;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// 不创建控制台窗口，避免 CLI/提权过程闪窗。
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// vxapo-cli 路径：env VXAPO_CLI 优先，缺省开发机固定路径。
static CLI_PATH: OnceLock<String> = OnceLock::new();

/// 设备配置根目录（安装器 / 驱动 / cli / 应用共用）。
const PROGRAM_DATA_ROOT: &str = r"C:\ProgramData\VxAPO";

/// 设备配置目录 `...\VxAPO\<guid>`。
fn device_dir(guid: &str) -> PathBuf {
    Path::new(PROGRAM_DATA_ROOT).join(guid)
}

/// 设备配置 `...\VxAPO\<guid>\config.toml`。
fn device_config_path(guid: &str) -> PathBuf {
    device_dir(guid).join("config.toml")
}

fn system_uses_dark_mode() -> bool {
    #[cfg(windows)]
    {
        let out = Command::new("reg")
            .args([
                "query",
                r"HKCU\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize",
                "/v",
                "AppsUseLightTheme",
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
        if let Ok(o) = out {
            if o.status.success() {
                let stdout = String::from_utf8_lossy(&o.stdout);
                return stdout.contains("0x0") && !stdout.contains("0x1");
            }
        }
        false
    }
    #[cfg(not(windows))]
    {
        false
    }
}

fn cli_path() -> &'static str {
    CLI_PATH.get_or_init(|| {
        if let Ok(p) = std::env::var("VXAPO_CLI") {
            return p;
        }

        // release：优先找 App exe 同目录的 vxapo-cli.exe（随包版本），
        // Tauri bundle.resources 可能放到 exe 同级或 resources 子目录。
        // 注意：CARGO_MANIFEST_DIR 只在 debug 构建使用——release 下它会固化到
        // 开发目录，导致安装版 App 误用开发目录的 CLI/DLL（CLSID 注册错路径）。
        #[cfg(not(debug_assertions))]
        if let Ok(exe) = std::env::current_exe() {
            if let Some(dir) = exe.parent() {
                let candidates = [dir.join("vxapo-cli.exe"), dir.join("resources").join("vxapo-cli.exe")];
                for cli in candidates {
                    if cli.exists() {
                        return cli.display().to_string();
                    }
                }
            }
        }

        // debug（tauri dev）：使用随源码打包的 resources 副本。
        #[cfg(debug_assertions)]
        {
            let manifest_cli = Path::new(env!("CARGO_MANIFEST_DIR")).join("resources").join("vxapo-cli.exe");
            if manifest_cli.exists() {
                return manifest_cli.display().to_string();
            }
        }

        // 找不到随包 CLI 时回落到 exe 同目录名：启动会明确失败并提示检查安装或 `VXAPO_CLI`。
        if let Ok(exe) = std::env::current_exe() {
            if let Some(dir) = exe.parent() {
                return dir.join("vxapo-cli.exe").display().to_string();
            }
        }
        "vxapo-cli.exe".to_string()
    })
}

/// 原子写 config.toml（临时文件 + rename，UTF-8 无 BOM）。
#[tauri::command]
fn write_config(guid: String, content: String) -> Result<(), String> {
    let dir = device_dir(&guid);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let tmp = Path::new(&dir).join("config.toml.tmp");
    let final_path = Path::new(&dir).join("config.toml");
    std::fs::write(&tmp, content.as_bytes()).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &final_path).map_err(|e| e.to_string())
}

/// 读回 per-device config.toml。
#[tauri::command]
fn read_config(guid: String) -> Result<String, String> {
    let path = device_config_path(&guid);
    match std::fs::read_to_string(&path) {
        Ok(s) => Ok(s),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(e.to_string()),
    }
}

/// 轮询快路径返回值：revision 为内容指纹；内容未变时 text 为 None。
#[derive(serde::Serialize)]
struct ConfigRead {
    revision: String,
    text: Option<String>,
}

/// FNV-1a 64 位内容指纹：用于判断 config.toml 是否真的变化。
fn config_revision(bytes: &[u8]) -> String {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in bytes {
        h ^= *b as u64;
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{h:016x}")
}

/// 读取 per-device config.toml；内容与 known_revision 相同则不回传文本。
#[tauri::command]
fn read_config_checked(
    guid: String,
    known_revision: Option<String>,
) -> Result<ConfigRead, String> {
    let path = device_config_path(&guid);
    let bytes = match std::fs::read(&path) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Vec::new(),
        Err(e) => return Err(e.to_string()),
    };
    let revision = config_revision(&bytes);
    if known_revision.as_deref() == Some(revision.as_str()) {
        return Ok(ConfigRead {
            revision,
            text: None,
        });
    }
    Ok(ConfigRead {
        revision,
        text: Some(String::from_utf8_lossy(&bytes).into_owned()),
    })
}

/// 读取导入文件内容（前端拖拽导入时使用）。
#[tauri::command]
fn read_import_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

/// 语言文件固定位置（与 config 同目录约定；安装器与应用设置共用）。
fn lang_file_path() -> PathBuf {
    Path::new(PROGRAM_DATA_ROOT).join("lang.txt")
}

/// 读取界面语言（"zh" / "en"；无文件或内容非法返回空串）。
/// 回退到可执行文件目录下的 lang.txt（旧版安装器遗留）。
#[tauri::command]
fn read_lang(app: tauri::AppHandle) -> Result<String, String> {
    let mut candidates = vec![lang_file_path()];
    if let Ok(dir) = app.path().executable_dir() {
        candidates.push(dir.join("lang.txt"));
    }
    for p in candidates {
        if let Ok(s) = std::fs::read_to_string(p) {
            let v = s.trim();
            if v == "zh" || v == "en" {
                return Ok(v.to_string());
            }
            return Ok(String::new());
        }
    }
    Ok(String::new())
}

/// 写入界面语言（设置里切换时调用；与安装器共用同一个 lang.txt）。
#[tauri::command]
fn write_lang(lang: String) -> Result<(), String> {
    if lang != "zh" && lang != "en" {
        return Err(E_INVALID_LANG.to_string());
    }
    let path = lang_file_path();
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    std::fs::write(path, lang).map_err(|e| e.to_string())
}

/// 前端资源渲染完成后显示主窗口（配合 visible:false，消除白屏一闪）。
#[tauri::command]
fn show_main_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("main") {
        let (r, g, b) = if system_uses_dark_mode() {
            (0x16u8, 0x18u8, 0x1bu8)
        } else {
            (0xf0u8, 0xf3u8, 0xf6u8)
        };
        
        // 先设置背景色
        let _ = win.set_background_color(Some(tauri::window::Color(r, g, b, 255)));
        
        // 再注入 JS 确保 WebView 使用正确的颜色
        let color_hex = if system_uses_dark_mode() { "#16181b" } else { "#f0f3f6" };
        let _ = win.eval(&format!("
            document.documentElement.style.backgroundColor = '{}';
            document.body.style.backgroundColor = '{}';
            document.getElementById('root').style.backgroundColor = '{}';
        ", color_hex, color_hex, color_hex));
        
        // 最后显示窗口
        win.show().map_err(|e| e.to_string())?;
        
        // 如果需要最大化
        win.maximize().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 导出当前设备 config.toml 到用户选择的路径。
#[tauri::command]
fn export_config(guid: String, path: String) -> Result<(), String> {
    let src = device_config_path(&guid);
    let content = std::fs::read_to_string(&src).map_err(|e| e.to_string())?;
    std::fs::write(&path, content.as_bytes()).map_err(|e| e.to_string())
}

/// 在 Windows 资源管理器中选中导出文件。
#[tauri::command]
fn open_in_explorer(path: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        Command::new("explorer.exe")
            .arg("/select,")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(not(windows))]
    {
        let _ = path;
    }
    Ok(())
}

/// 设备列表（CLI list --json，UI 设计规范 05）；Rust 侧反序列化，
/// 前端直接拿到强类型数组，避免字符串二次解析。
#[derive(Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
struct Device {
    index: i64,
    name: String,
    guid: String,
    #[serde(default)]
    device_id: Option<String>,
    #[serde(default)]
    connection: Option<String>,
    #[serde(default)]
    installed_version: Option<String>,
    #[serde(default)]
    install_mode: Option<String>,
    #[serde(default)]
    slots: HashMap<String, Option<String>>,
    #[serde(default)]
    sample_rate: Option<f64>,
    #[serde(default)]
    channels: Option<i64>,
    #[serde(default)]
    bit_depth: Option<i64>,
    #[serde(default)]
    kind: Option<String>,
    #[serde(default)]
    volume: Option<f64>,
    #[serde(default)]
    eapo: Option<String>,
    #[serde(default)]
    lost_slot: Option<String>,
}

/// 安装结果（install_device 返回；前端 InstallDialog 消费）。
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct InstallResult {
    success: bool,
    mode: Option<String>,
    score: Option<u32>,
    attempts: u32,
    best_mode: Option<String>,
    best_score: Option<u32>,
}

#[tauri::command]
fn list_devices() -> Result<Vec<Device>, String> {
    let mut cmd = Command::new(cli_path());
    cmd.args(["list", "--json"]);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let out = cmd.output().map_err(|e| coded(E_CLI_SPAWN, e))?;
    if out.status.success() {
        let raw = String::from_utf8_lossy(&out.stdout).trim().to_string();
        serde_json::from_str(&raw).map_err(|e| coded(E_CLI_PARSE, e))
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

// ── 提权执行：共用部分 ──────────────────────────────────────────────────
//
// 两条引擎（run_cli_elevated / run_cli_elevated_stream）只差「等退出取 stdout」与
// 「流式转发事件」；脚本生成、提权拉起、完成标记轮询都在这里共用。

/// 结构化错误码：跨 IPC 只传码（可带 `: 详情`），文案由前端按 i18n 渲染。
const E_TIMEOUT: &str = "E_TIMEOUT";
const E_ELEVATION: &str = "E_ELEVATION";
const E_SCRIPT: &str = "E_SCRIPT";
const E_OP_FAILED: &str = "E_OP_FAILED";
const E_INSTALL_FAILED: &str = "E_INSTALL_FAILED";
const E_CLI_SPAWN: &str = "E_CLI_SPAWN";
const E_CLI_PARSE: &str = "E_CLI_PARSE";
const E_CLI_WAIT: &str = "E_CLI_WAIT";
const E_INVALID_LANG: &str = "E_INVALID_LANG";
const E_INSTALL_THREAD: &str = "E_INSTALL_THREAD";
const E_INSTALL_NO_RESULT: &str = "E_INSTALL_NO_RESULT";

/// `E_Xxx: 详情`（详情供排障，前端拼在文案后）。
fn coded(code: &str, detail: impl std::fmt::Display) -> String {
    format!("{code}: {detail}")
}

/// 一次提权调用的临时文件（同一 tag，放系统临时目录）。
struct ElevationFiles {
    ps1: PathBuf,
    vbs: PathBuf,
    err: PathBuf,
    done: PathBuf,
    outer: PathBuf,
    log: PathBuf,
}

impl ElevationFiles {
    fn new(tag: &str) -> Self {
        let tmp = std::env::temp_dir();
        let p = |ext: &str| tmp.join(format!("vxapo_{tag}.{ext}"));
        Self {
            ps1: p("ps1"),
            vbs: p("vbs"),
            err: p("err.txt"),
            done: p("done"),
            outer: p("outer.txt"),
            log: p("log"),
        }
    }

    /// 清掉上一轮残留（启动前）。
    fn reset(&self) {
        for p in [&self.ps1, &self.vbs, &self.err, &self.done, &self.outer, &self.log] {
            let _ = std::fs::remove_file(p);
        }
    }

    /// 收尾：脚本与标记文件一律删除；结果文件由调用方按需处理。
    fn cleanup(&self) {
        for p in [&self.ps1, &self.vbs, &self.outer, &self.done] {
            let _ = std::fs::remove_file(p);
        }
    }

    fn log(&self, m: &str) {
        let _ = std::fs::write(&self.log, format!("{m}\n"));
    }

    /// CLI 的标准错误（已 trim）。
    fn stderr(&self) -> String {
        std::fs::read_to_string(&self.err).unwrap_or_default().trim().to_string()
    }

    /// 完成标记里的退出码（未完成时返回 None）。
    fn exit_code(&self) -> Option<i32> {
        let raw = std::fs::read_to_string(&self.done).unwrap_or_default();
        let t = raw.trim().trim_start_matches('\u{feff}').trim();
        if t.is_empty() {
            None
        } else {
            Some(t.parse().unwrap_or(1))
        }
    }

    /// 失败原因：CLI 的 stderr 优先，空则回落到错误码。
    fn fail_or(&self, code: &str) -> String {
        let msg = self.stderr();
        if msg.is_empty() {
            code.to_string()
        } else {
            msg
        }
    }
}

/// 轮询结果。
enum PollResult {
    /// CLI 已退出（带退出码）。
    Done(i32),
    /// 脚本/CLI 写出了错误文本（已 trim，非空）。
    Failed(String),
    /// 超时兜底。
    Timeout,
}

/// 写提权脚本：ps1 运行 CLI 并把退出码写进 `.done`；vbs 用 ShellExecute runas
/// 隐藏窗口拉起 ps1（不弹控制台；启动失败把返回码写进 `.outer`）。
///
/// `stdout_to`：`Some(p)` 把 CLI stdout 重定向到 p（非流式，完成后整体读回）；
/// `None` 丢弃 stdout（流式，事件经 `--progress-file` 增量转发）。
fn build_elevation_scripts(
    cli: &str,
    args: &[&str],
    f: &ElevationFiles,
    stdout_to: Option<&Path>,
) -> Result<(), String> {
    let quoted: Vec<String> = args.iter().map(|a| format!("'{}'", a.replace('\'', "''"))).collect();
    let stdout = match stdout_to {
        Some(p) => format!("'{}'", p.display().to_string().replace('\'', "''")),
        None => "$null".to_string(),
    };
    let inner = format!(
        "& '{}' {} 1> {} 2> '{}'; $code = $LASTEXITCODE; [System.IO.File]::WriteAllText('{}', \"$code\"); exit $code",
        cli.replace('\'', "''"),
        quoted.join(" "),
        stdout,
        f.err.display().to_string().replace('\'', "''"),
        f.done.display().to_string().replace('\'', "''"),
    );
    std::fs::write(&f.ps1, inner).map_err(|e| coded(E_SCRIPT, e))?;

    let vbs = format!(
        r#"On Error Resume Next
Set s = CreateObject("Shell.Application")
r = s.ShellExecute("powershell.exe", "-NoProfile -ExecutionPolicy Bypass -File {ps1}", "", "runas", 0)
If r <= 32 Then
  Set fso = CreateObject("Scripting.FileSystemObject")
  fso.CreateTextFile("{outer}", True).Write CStr(r)
End If"#,
        ps1 = f.ps1.display(),
        outer = f.outer.display(),
    );
    std::fs::write(&f.vbs, vbs).map_err(|e| coded(E_SCRIPT, e))
}

/// 以隐藏窗口拉起提权脚本（wscript → ShellExecute runas）。
fn spawn_elevation(f: &ElevationFiles) -> Result<(), String> {
    Command::new("wscript.exe")
        .arg(&f.vbs)
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map(|_| ())
        .map_err(|e| {
            f.log(&format!("spawn-error: {e}"));
            coded(E_ELEVATION, e)
        })
}

/// 轮询完成标记：`.done` 出现即返回退出码；`.err`/`.outer` 有内容即失败；超时兜底。
/// `on_tick` 每轮调用一次（流式引擎用它转发进度事件）。
fn poll_completion(
    f: &ElevationFiles,
    timeout: std::time::Duration,
    poll_ms: u64,
    mut on_tick: impl FnMut(),
) -> PollResult {
    let deadline = std::time::Instant::now() + timeout;
    loop {
        on_tick();
        if let Some(code) = f.exit_code() {
            return PollResult::Done(code);
        }
        let msg = f.stderr();
        if !msg.is_empty() {
            f.log(&format!("err: {msg}"));
            return PollResult::Failed(msg);
        }
        let outer = std::fs::read_to_string(&f.outer).unwrap_or_default();
        if !outer.trim().is_empty() {
            f.log(&format!("outer-err: {}", outer.trim()));
            return PollResult::Failed(outer.trim().to_string());
        }
        if std::time::Instant::now() >= deadline {
            f.log("timeout");
            return PollResult::Timeout;
        }
        std::thread::sleep(std::time::Duration::from_millis(poll_ms));
    }
}
/// 提权运行 CLI 子命令并取回 stdout（非流式）。
///
/// 进度逐行写入 progress 文件（应用可读），完成标记（退出码）驱动判定；
/// 用 ShellExecute runas + 隐藏窗口拉起，不弹控制台。
fn run_cli_elevated(cli: &str, args: &[&str], tag: &str) -> Result<String, String> {
    let f = ElevationFiles::new(tag);
    let progress = std::env::temp_dir().join(format!("vxapo_{tag}.progress"));
    f.reset();
    let _ = std::fs::remove_file(&progress);
    f.log("start");

    build_elevation_scripts(cli, args, &f, Some(&progress))?;
    spawn_elevation(&f)?;
    f.log("spawned");

    // 只认完成标记：退出码 0 成功；错误文件有内容报错；90s 超时兜底。
    let outcome = poll_completion(&f, std::time::Duration::from_secs(90), 300, || {});
    match outcome {
        PollResult::Done(0) => {
            f.log("done-ok");
            let out = std::fs::read_to_string(&progress).unwrap_or_default();
            let _ = std::fs::remove_file(&f.log);
            let _ = std::fs::remove_file(&progress);
            let _ = std::fs::remove_file(&f.err);
            f.cleanup();
            Ok(out.trim().to_string())
        }
        PollResult::Done(code) => {
            f.log(&format!("done-fail:{code}"));
            let msg = f.fail_or(E_OP_FAILED);
            f.cleanup();
            Err(msg)
        }
        PollResult::Failed(msg) => {
            f.cleanup();
            Err(msg)
        }
        PollResult::Timeout => {
            f.cleanup();
            Err(E_TIMEOUT.to_string())
        }
    }
}

/// 优先直接运行 CLI（应用本身有权限时不弹任何提权窗口）；
/// 只有提示“需要管理员权限”时才走隐藏的提权包装。
fn run_cli(cli: &str, args: &[&str], tag: &str) -> Result<String, String> {
    let output = Command::new(cli)
        .args(args)
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| coded(E_CLI_SPAWN, e))?;
    let out = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if output.status.success() {
        return Ok(out);
    }
    let msg = if err.is_empty() { out } else { err };
    if msg.contains("需要管理员权限")
        || msg.to_lowercase().contains("administrator privileges")
    {
        return run_cli_elevated(cli, args, tag);
    }
    Err(if msg.is_empty() {
        "CLI 执行失败".to_string()
    } else {
        msg
    })
}

/// 流式运行 CLI 并转发 JSON 事件（`install --verify` 专用）。
///
/// 直连路径：stdout 管道逐行解析事件；报“需要管理员权限”时降级提权路径
/// （VBS/runas 隐藏窗口），提权路径下 CLI 通过 `--progress-file` 追加事件，
/// 本函数按字节偏移增量读取并转发。两条路径对外行为一致。
fn run_cli_with_events(
    cli: &str,
    args: &[&str],
    tag: &str,
    on_event: &mut dyn FnMut(serde_json::Value),
) -> Result<String, String> {
    let mut cmd = Command::new(cli);
    cmd.args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let mut child = cmd.spawn().map_err(|e| coded(E_CLI_SPAWN, e))?;

    // stderr 用线程收集，避免管道填满阻塞。
    let stderr = child.stderr.take();
    let stderr_thread = std::thread::spawn(move || {
        let mut s = String::new();
        if let Some(mut e) = stderr {
            let _ = std::io::Read::read_to_string(&mut e, &mut s);
        }
        s
    });

    let mut out = String::new();
    if let Some(stdout) = child.stdout.take() {
        for line in BufReader::new(stdout).lines() {
            if let Ok(line) = line {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) {
                    on_event(v);
                }
                out.push_str(&line);
                out.push('\n');
            }
        }
    }
    let status = child.wait().map_err(|e| coded(E_CLI_WAIT, e))?;
    let err = stderr_thread.join().unwrap_or_default();
    let out_trim = out.trim().to_string();
    let err_trim = err.trim().to_string();

    if status.success() {
        return Ok(out_trim);
    }
    let msg = if err_trim.is_empty() {
        out_trim.clone()
    } else {
        err_trim.clone()
    };
    if msg.contains("需要管理员权限")
        || msg.to_lowercase().contains("administrator privileges")
    {
        let progress = std::env::temp_dir().join(format!("vxapo_{tag}.progress"));
        return run_cli_elevated_stream(cli, args, tag, &progress, on_event);
    }
    Err(msg)
}

/// 提权流式执行：stdout 指 NUL（避免与 CLI 追加写 progress 文件冲突），
/// 事件经 `--progress-file` 增量读取转发；`.done`/`.err` 判定沿用原逻辑。
/// 提权流式执行：stdout 指 NUL（避免与 CLI 追加写 progress 文件冲突），
/// 事件经 `--progress-file` 增量读取转发；完成标记判定与非流式一致。
fn run_cli_elevated_stream(
    cli: &str,
    args: &[&str],
    tag: &str,
    progress: &Path,
    on_event: &mut dyn FnMut(serde_json::Value),
) -> Result<String, String> {
    let f = ElevationFiles::new(tag);
    f.reset();
    let _ = std::fs::remove_file(progress);
    f.log("stream-start");

    build_elevation_scripts(cli, args, &f, None)?;
    spawn_elevation(&f)?;
    f.log("stream-spawned");

    let mut offset: u64 = 0;
    let outcome = poll_completion(&f, std::time::Duration::from_secs(300), 200, || {
        drain_progress(progress, &mut offset, on_event);
    });
    match outcome {
        PollResult::Done(code) => {
            drain_progress(progress, &mut offset, on_event);
            let msg = f.stderr();
            f.log(&format!("stream-done:{code}"));
            f.cleanup();
            if code == 0 {
                let _ = std::fs::remove_file(&f.log);
                let _ = std::fs::remove_file(&f.err);
                Ok(msg)
            } else if msg.is_empty() {
                Err(E_INSTALL_FAILED.to_string())
            } else {
                Err(msg)
            }
        }
        PollResult::Failed(msg) => {
            f.cleanup();
            Err(msg)
        }
        PollResult::Timeout => {
            f.cleanup();
            Err(E_TIMEOUT.to_string())
        }
    }
}

/// 增量读取 progress 文件：只推进到最后一个完整行（含换行），避免切半行丢事件。
fn drain_progress(
    path: &Path,
    offset: &mut u64,
    on_event: &mut dyn FnMut(serde_json::Value),
) {
    use std::io::{Read, Seek, SeekFrom};
    let Ok(mut f) = std::fs::File::open(path) else {
        return;
    };
    if f.seek(SeekFrom::Start(*offset)).is_err() {
        return;
    }
    let mut s = String::new();
    if f.read_to_string(&mut s).is_err() {
        return;
    }
    let bytes = s.as_bytes();
    let last_nl = bytes.iter().rposition(|&b| b == b'\n').map(|p| p + 1).unwrap_or(0);
    if last_nl == 0 {
        return;
    }
    *offset += last_nl as u64;
    for line in s[..last_nl].lines() {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(line) {
            on_event(v);
        }
    }
}

/// 从 CLI 的 complete 事件构造 InstallResult。
fn install_result_from_event(v: &serde_json::Value) -> InstallResult {
    let get_u32 = |k: &str| v.get(k).and_then(|x| x.as_u64()).map(|n| n as u32);
    InstallResult {
        success: v.get("success").and_then(|s| s.as_bool()).unwrap_or(false),
        mode: v.get("mode").and_then(|m| m.as_str()).map(|s| s.to_string()),
        score: get_u32("score"),
        attempts: get_u32("attempts").unwrap_or(0),
        best_mode: v
            .get("best_mode")
            .and_then(|m| m.as_str())
            .map(|s| s.to_string()),
        best_score: get_u32("best_score"),
    }
}

/// 卸载设备：以 `runas` 提权调 `vxapo-cli uninstall -d <guid> --json`。
#[tauri::command]
fn uninstall_device(guid: String) -> Result<String, String> {
    let cli = cli_path();
    let tag = format!("uninstall_{}", guid.replace(['{', '}'], ""));
    run_cli(cli, &["uninstall", "-d", &guid], &tag)
}

/// 安装设备（`--verify` 验证闭环）：后台线程流式执行 CLI 并逐行 emit
/// `install-progress` 事件；返回结构化 InstallResult。全程不阻塞命令线程。
#[tauri::command]
async fn install_device(app: tauri::AppHandle, guid: String) -> Result<InstallResult, String> {
    let cli = cli_path().to_string();
    let tag = format!("install_{}", guid.replace(['{', '}'], ""));
    let progress_path = std::env::temp_dir().join(format!("vxapo_{tag}.progress"));
    let args: Vec<String> = vec![
        "install".to_string(),
        "-d".to_string(),
        guid,
        "--verify".to_string(),
        "--progress-file".to_string(),
        progress_path.to_string_lossy().into_owned(),
    ];

    let last_complete: std::sync::Arc<std::sync::Mutex<Option<serde_json::Value>>> =
        std::sync::Arc::new(std::sync::Mutex::new(None));
    let lc = last_complete.clone();
    let app2 = app.clone();

    let result = tauri::async_runtime::spawn_blocking(move || {
        let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        let mut on_event = |ev: serde_json::Value| {
            if ev.get("event").and_then(|e| e.as_str()) == Some("complete") {
                if let Ok(mut g) = lc.lock() {
                    *g = Some(ev.clone());
                }
            }
            let _ = app2.emit("install-progress", &ev);
        };
        run_cli_with_events(&cli, &arg_refs, &tag, &mut on_event)
    })
    .await
    .map_err(|e| coded(E_INSTALL_THREAD, e))?;

    if let Some(complete) = last_complete.lock().unwrap().clone() {
        // 成功：清理临时进度文件；失败保留，供诊断（trace 步骤在 progress 里）。
        if complete.get("success").and_then(|s| s.as_bool()).unwrap_or(false) {
            let _ = std::fs::remove_file(&progress_path);
        }
        return Ok(install_result_from_event(&complete));
    }
    let tail = progress_tail(&progress_path, 12);
    let msg = match result {
        Ok(out) => coded(E_INSTALL_NO_RESULT, out.trim()),
        Err(e) => e,
    };
    Err(if tail.is_empty() {
        msg
    } else {
        format!("{msg}\n--- 进度尾部 ---\n{tail}")
    })
}

/// 读取 progress 文件最后 N 行（失败诊断）。
fn progress_tail(path: &Path, max_lines: usize) -> String {
    let Ok(s) = std::fs::read_to_string(path) else {
        return String::new();
    };
    s.lines()
        .rev()
        .take(max_lines)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>()
        .join("\n")
}

/// 安装失败后的兜底回滚：走 CLI uninstall（提权），清除已写入的注册表配置，
/// 保证设备不残留"已安装"状态（不产生假设备页）。
#[tauri::command]
fn rollback_install(guid: String) -> Result<String, String> {
    let cli = cli_path();
    let tag = format!("rollback_{}", guid.replace(['{', '}'], ""));
    run_cli(cli, &["uninstall", "-d", &guid], &tag)
}

/// 旧 GUID 残留列表（只读，无需提权）。
#[tauri::command]
fn list_stale_installs() -> Result<serde_json::Value, String> {
    let cli = cli_path();
    let out = run_cli(cli, &["stale", "list", "--json"], "stale_list")?;
    serde_json::from_str(&out).map_err(|e| coded(E_CLI_PARSE, e))
}

/// 迁移旧 GUID 到当前端点（需要管理员，run_cli 会自动提权）。
#[tauri::command]
fn migrate_stale_install(
    from: String,
    to: String,
    config_from: Option<String>,
    snapshot_from: Option<String>,
) -> Result<String, String> {
    let cli = cli_path();
    let tag = format!("stale_migrate_{}", from.replace(['{', '}'], ""));
    let mut args: Vec<String> = vec![
        "stale".to_string(),
        "migrate".to_string(),
        "--from".to_string(),
        from,
        "--to".to_string(),
        to,
        "--json".to_string(),
    ];
    if let Some(v) = config_from {
        args.push("--config-from".to_string());
        args.push(v);
    }
    if let Some(v) = snapshot_from {
        args.push("--snapshot-from".to_string());
        args.push(v);
    }
    let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    run_cli(cli, &refs, &tag)
}

/// 清理旧 GUID 残留（需要管理员，run_cli 会自动提权）。
#[tauri::command]
fn cleanup_stale_install(guid: String) -> Result<String, String> {
    let cli = cli_path();
    let tag = format!("stale_cleanup_{}", guid.replace(['{', '}'], ""));
    run_cli(cli, &["stale", "cleanup", "-d", &guid, "--json"], &tag)
}

/// 修复迁移后 config/snapshot 的用户 ACL（需要管理员，run_cli 自动提权）。
#[tauri::command]
fn repair_stale_acl(guid: String) -> Result<String, String> {
    let cli = cli_path();
    let tag = format!("stale_fix_acl_{}", guid.replace(['{', '}'], ""));
    run_cli(cli, &["stale", "fix-acl", "-d", &guid, "--json"], &tag)
}

/// 读取安装/卸载进度文本（供 UI 实时展示）。
#[tauri::command]
fn read_progress(tag: String) -> String {
    let p = std::env::temp_dir().join(format!("vxapo_{tag}.progress"));
    std::fs::read_to_string(p).unwrap_or_default()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if let Some(win) = app.get_webview_window("main") {
                let (r, g, b) = if system_uses_dark_mode() {
                    (0x16u8, 0x18u8, 0x1bu8)
                } else {
                    (0xf0u8, 0xf3u8, 0xf6u8)
                };
                let _ = win.set_background_color(Some(tauri::window::Color(r, g, b, 255)));
            }
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            write_config,
            read_config,
            read_config_checked,
            read_import_file,
            read_lang,
            write_lang,
            show_main_window,
            export_config,
            open_in_explorer,
            list_devices,
            uninstall_device,
            install_device,
            rollback_install,
            list_stale_installs,
            migrate_stale_install,
            cleanup_stale_install,
            repair_stale_acl,
            read_progress
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
