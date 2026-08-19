use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::path::Path;
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

        // 开发机回退：优先选择带有 vxapo_driver.dll 的 target\release 目录。
        let candidates = [
            r"D:\APO_Project\VxAPO\vxapo-cli\target\release\vxapo-cli.exe",
            r"D:\APO_Project\VxAPO\vxapo-cli\target\x86_64-pc-windows-msvc\release\vxapo-cli.exe",
        ];
        for cli in candidates {
            if Path::new(cli).exists() {
                return cli.to_string();
            }
        }
        candidates[0].to_string()
    })
}

/// 原子写 config.toml（临时文件 + rename，UTF-8 无 BOM）。
#[tauri::command]
fn write_config(guid: String, content: String) -> Result<(), String> {
    let dir = format!(r"C:\ProgramData\VxAPO\{guid}");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let tmp = Path::new(&dir).join("config.toml.tmp");
    let final_path = Path::new(&dir).join("config.toml");
    std::fs::write(&tmp, content.as_bytes()).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &final_path).map_err(|e| e.to_string())
}

/// 读回 per-device config.toml。
#[tauri::command]
fn read_config(guid: String) -> Result<String, String> {
    let path = format!(r"C:\ProgramData\VxAPO\{guid}\config.toml");
    match std::fs::read_to_string(&path) {
        Ok(s) => Ok(s),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(e.to_string()),
    }
}

/// 读取导入文件内容（前端拖拽导入时使用）。
#[tauri::command]
fn read_import_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
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
    let src = format!(r"C:\ProgramData\VxAPO\{guid}\config.toml");
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
    let out = cmd.output().map_err(|e| format!("CLI 启动失败：{e}"))?;
    if out.status.success() {
        let raw = String::from_utf8_lossy(&out.stdout).trim().to_string();
        serde_json::from_str(&raw).map_err(|e| format!("CLI 输出解析失败：{e}"))
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

/// 以提权方式运行 CLI 子命令并捕获 stdout/stderr。
/// 外层只做 RunAs（不带重定向，避免参数集冲突），
/// 以隐藏提权方式运行 CLI 子命令：
/// - 进度逐行写入 progress 文件（应用实时读取展示）；
/// - 完成标记（退出码）驱动应用判定；
/// - 用 ShellExecute runas + 隐藏窗口拉起，不弹控制台。
fn run_cli_elevated(cli: &str, args: &[&str], tag: &str) -> Result<String, String> {
    let tmp_progress = std::env::temp_dir().join(format!("vxapo_{tag}.progress"));
    let tmp_err = std::env::temp_dir().join(format!("vxapo_{tag}.err.txt"));
    let tmp_ps1 = std::env::temp_dir().join(format!("vxapo_{tag}.ps1"));
    let tmp_vbs = std::env::temp_dir().join(format!("vxapo_{tag}.vbs"));
    let outer_err = std::env::temp_dir().join(format!("vxapo_{tag}.outer.txt"));
    let log_file = std::env::temp_dir().join(format!("vxapo_{tag}.log"));
    let tmp_done = std::env::temp_dir().join(format!("vxapo_{tag}.done"));
    for p in [&tmp_progress, &tmp_err, &tmp_ps1, &tmp_vbs, &outer_err, &log_file, &tmp_done] {
        let _ = std::fs::remove_file(p);
    }
    let log = |m: &str| {
        let _ = std::fs::write(&log_file, format!("{}\n", m));
    };
    let cleanup = || {
        for p in [&tmp_ps1, &tmp_vbs, &outer_err, &tmp_done] {
            let _ = std::fs::remove_file(p);
        }
    };
    log("start");

    let quoted: Vec<String> = args
        .iter()
        .map(|a| format!("'{}'", a.replace('\'', "''")))
        .collect();
    let inner = format!(
        "& '{}' {} 1> '{}' 2> '{}'; $code = $LASTEXITCODE; [System.IO.File]::WriteAllText('{}', \"$code\"); exit $code",
        cli.replace('\'', "''"),
        quoted.join(" "),
        tmp_progress.display().to_string().replace('\'', "''"),
        tmp_err.display().to_string().replace('\'', "''"),
        tmp_done.display().to_string().replace('\'', "''"),
    );
    std::fs::write(&tmp_ps1, inner).map_err(|e| format!("写入提权脚本失败：{e}"))?;
    log("ps1-written");

    // VBS：ShellExecute runas + 隐藏窗口（0），彻底不弹控制台；
    // 启动失败时把返回码写进 outer_err 供快速失败。
    let ps1_path = tmp_ps1.display().to_string();
    let oerr_path = outer_err.display().to_string();
    let vbs = format!(
        r#"On Error Resume Next
Set s = CreateObject("Shell.Application")
r = s.ShellExecute("powershell.exe", "-NoProfile -ExecutionPolicy Bypass -File {ps1}", "", "runas", 0)
If r <= 32 Then
  Set fso = CreateObject("Scripting.FileSystemObject")
  fso.CreateTextFile("{oerr}", True).Write CStr(r)
End If"#,
        ps1 = ps1_path,
        oerr = oerr_path,
    );
    std::fs::write(&tmp_vbs, vbs).map_err(|e| format!("写入提权脚本失败：{e}"))?;
    log("vbs-written");

    let spawn_result = Command::new("wscript.exe")
        .arg(&tmp_vbs)
        .creation_flags(CREATE_NO_WINDOW)
        .spawn();
    if let Err(e) = spawn_result {
        log(&format!("spawn-error: {e}"));
        cleanup();
        return Err(format!("提权启动失败：{e}"));
    }
    log("spawned");

    // 只认完成标记：退出码 0 成功；错误文件有内容报错；90s 超时兜底。
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(90);
    log("polling");
    loop {
        let done = std::fs::read_to_string(&tmp_done).unwrap_or_default();
        let done_raw = done.trim().trim_start_matches('\u{feff}').trim();
        if !done_raw.is_empty() {
            let code: i32 = done_raw.parse().unwrap_or(1);
            let progress = std::fs::read_to_string(&tmp_progress).unwrap_or_default();
            if code == 0 {
                log("done-ok");
                cleanup();
                let _ = std::fs::remove_file(&log_file);
                let _ = std::fs::remove_file(&tmp_progress);
                let _ = std::fs::remove_file(&tmp_err);
                return Ok(progress.trim().to_string());
            }
            let err = std::fs::read_to_string(&tmp_err).unwrap_or_default();
            let msg = err.trim();
            log(&format!("done-fail:{code} raw:[{done_raw}]"));
            cleanup();
            return Err(if msg.is_empty() {
                "操作失败".to_string()
            } else {
                msg.to_string()
            });
        }
        let err = std::fs::read_to_string(&tmp_err).unwrap_or_default();
        if !err.trim().is_empty() {
            let msg = err.trim();
            log(&format!("err: {msg}"));
            cleanup();
            return Err(if msg.is_empty() {
                "操作失败".to_string()
            } else {
                msg.to_string()
            });
        }
        let oerr = std::fs::read_to_string(&outer_err).unwrap_or_default();
        if !oerr.trim().is_empty() {
            log(&format!("outer-err: {}", oerr.trim()));
            cleanup();
            return Err(oerr.trim().to_string());
        }
        if std::time::Instant::now() >= deadline {
            log("timeout");
            cleanup();
            return Err("操作超时".to_string());
        }
        std::thread::sleep(std::time::Duration::from_millis(300));
    }
}

/// 优先直接运行 CLI（应用本身有权限时不弹任何提权窗口）；
/// 只有提示“需要管理员权限”时才走隐藏的提权包装。
fn run_cli(cli: &str, args: &[&str], tag: &str) -> Result<String, String> {
    let output = Command::new(cli)
        .args(args)
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| format!("CLI 启动失败：{e}"))?;
    let out = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if output.status.success() {
        return Ok(out);
    }
    let msg = if err.is_empty() { out } else { err };
    if msg.contains("需要管理员权限") {
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
    let mut child = cmd.spawn().map_err(|e| format!("CLI 启动失败：{e}"))?;

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
    let status = child.wait().map_err(|e| format!("CLI 等待失败：{e}"))?;
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
    if msg.contains("需要管理员权限") {
        let progress = std::env::temp_dir().join(format!("vxapo_{tag}.progress"));
        return run_cli_elevated_stream(cli, args, tag, &progress, on_event);
    }
    Err(msg)
}

/// 提权流式执行：stdout 指 NUL（避免与 CLI 追加写 progress 文件冲突），
/// 事件经 `--progress-file` 增量读取转发；`.done`/`.err` 判定沿用原逻辑。
fn run_cli_elevated_stream(
    cli: &str,
    args: &[&str],
    tag: &str,
    progress: &Path,
    on_event: &mut dyn FnMut(serde_json::Value),
) -> Result<String, String> {
    let tmp_err = std::env::temp_dir().join(format!("vxapo_{tag}.err.txt"));
    let tmp_ps1 = std::env::temp_dir().join(format!("vxapo_{tag}.ps1"));
    let tmp_vbs = std::env::temp_dir().join(format!("vxapo_{tag}.vbs"));
    let outer_err = std::env::temp_dir().join(format!("vxapo_{tag}.outer.txt"));
    let log_file = std::env::temp_dir().join(format!("vxapo_{tag}.log"));
    let tmp_done = std::env::temp_dir().join(format!("vxapo_{tag}.done"));
    for p in [&tmp_err, &tmp_ps1, &tmp_vbs, &outer_err, &log_file, &tmp_done] {
        let _ = std::fs::remove_file(p);
    }
    let _ = std::fs::remove_file(progress);
    let log = |m: &str| {
        let _ = std::fs::write(&log_file, format!("{}\n", m));
    };
    let cleanup = || {
        for p in [&tmp_ps1, &tmp_vbs, &outer_err, &tmp_done] {
            let _ = std::fs::remove_file(p);
        }
    };
    log("stream-start");

    let quoted: Vec<String> = args
        .iter()
        .map(|a| format!("'{}'", a.replace('\'', "''")))
        .collect();
    let inner = format!(
        "& '{}' {} 1> $null 2> '{}'; $code = $LASTEXITCODE; [System.IO.File]::WriteAllText('{}', \"$code\"); exit $code",
        cli.replace('\'', "''"),
        quoted.join(" "),
        tmp_err.display().to_string().replace('\'', "''"),
        tmp_done.display().to_string().replace('\'', "''"),
    );
    std::fs::write(&tmp_ps1, inner).map_err(|e| format!("写入提权脚本失败：{e}"))?;

    let ps1_path = tmp_ps1.display().to_string();
    let oerr_path = outer_err.display().to_string();
    let vbs = format!(
        r#"On Error Resume Next
Set s = CreateObject("Shell.Application")
r = s.ShellExecute("powershell.exe", "-NoProfile -ExecutionPolicy Bypass -File {ps1}", "", "runas", 0)
If r <= 32 Then
  Set fso = CreateObject("Scripting.FileSystemObject")
  fso.CreateTextFile("{oerr}", True).Write CStr(r)
End If"#,
        ps1 = ps1_path,
        oerr = oerr_path,
    );
    std::fs::write(&tmp_vbs, vbs).map_err(|e| format!("写入提权脚本失败：{e}"))?;

    let spawn_result = Command::new("wscript.exe")
        .arg(&tmp_vbs)
        .creation_flags(CREATE_NO_WINDOW)
        .spawn();
    if let Err(e) = spawn_result {
        log(&format!("spawn-error: {e}"));
        cleanup();
        return Err(format!("提权启动失败：{e}"));
    }
    log("stream-spawned");

    let mut progress_offset: u64 = 0;
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(300);
    loop {
        drain_progress(progress, &mut progress_offset, on_event);

        let done = std::fs::read_to_string(&tmp_done).unwrap_or_default();
        let done_raw = done.trim().trim_start_matches('\u{feff}').trim();
        if !done_raw.is_empty() {
            let code: i32 = done_raw.parse().unwrap_or(1);
            drain_progress(progress, &mut progress_offset, on_event);
            let err = std::fs::read_to_string(&tmp_err).unwrap_or_default();
            let msg = err.trim().to_string();
            log(&format!("stream-done:{code}"));
            cleanup();
            if code == 0 {
                let _ = std::fs::remove_file(&log_file);
                let _ = std::fs::remove_file(&tmp_err);
                return Ok(msg);
            }
            return Err(if msg.is_empty() {
                "安装失败".to_string()
            } else {
                msg
            });
        }

        let err = std::fs::read_to_string(&tmp_err).unwrap_or_default();
        if !err.trim().is_empty() {
            let msg = err.trim().to_string();
            log(&format!("stream-err: {msg}"));
            cleanup();
            return Err(msg);
        }
        let oerr = std::fs::read_to_string(&outer_err).unwrap_or_default();
        if !oerr.trim().is_empty() {
            let msg = oerr.trim().to_string();
            log(&format!("stream-outer-err: {msg}"));
            cleanup();
            return Err(msg);
        }
        if std::time::Instant::now() >= deadline {
            log("stream-timeout");
            cleanup();
            return Err("安装超时（5 分钟）".to_string());
        }
        std::thread::sleep(std::time::Duration::from_millis(200));
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
    .map_err(|e| format!("安装线程异常：{e}"))?;

    if let Some(complete) = last_complete.lock().unwrap().clone() {
        // 成功：清理临时进度文件；失败保留，供诊断（trace 步骤在 progress 里）。
        if complete.get("success").and_then(|s| s.as_bool()).unwrap_or(false) {
            let _ = std::fs::remove_file(&progress_path);
        }
        return Ok(install_result_from_event(&complete));
    }
    let tail = progress_tail(&progress_path, 12);
    let msg = match result {
        Ok(out) => format!("安装结束但缺少结果事件：{}", out.trim()),
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
            read_import_file,
            show_main_window,
            export_config,
            open_in_explorer,
            list_devices,
            uninstall_device,
            install_device,
            rollback_install,
            read_progress
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
