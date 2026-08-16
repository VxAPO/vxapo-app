use std::collections::HashMap;
use std::path::Path;
use std::process::Command;
use std::sync::OnceLock;
use tauri::Manager;

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
        #[cfg(not(debug_assertions))]
        {
            // release：优先找 App exe 同目录的 vxapo-cli.exe（安装包部署布局）
            if let Ok(exe) = std::env::current_exe() {
                if let Some(dir) = exe.parent() {
                    let cli = dir.join("vxapo-cli.exe");
                    if cli.exists() {
                        return cli.display().to_string();
                    }
                }
            }
        }
        r"D:\APO_Project\VxAPO\vxapo-cli\target\release\vxapo-cli.exe".to_string()
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
        win.show().map_err(|e| e.to_string())?;
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

/// 卸载设备：以 `runas` 提权调 `vxapo-cli uninstall -d <guid> --json`。
#[tauri::command]
fn uninstall_device(guid: String) -> Result<String, String> {
    let cli = cli_path();
    let tag = format!("uninstall_{}", guid.replace(['{', '}'], ""));
    run_cli(cli, &["uninstall", "-d", &guid], &tag)
}

/// 安装设备：以 `runas` 提权调 `vxapo-cli install -d <guid> --json`
/// （自动探测安装模式）。
#[tauri::command]
fn install_device(guid: String) -> Result<String, String> {
    let cli = cli_path();
    let tag = format!("install_{}", guid.replace(['{', '}'], ""));
    run_cli(cli, &["install", "-d", &guid], &tag)
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
                // 等 WebView 完成首帧后再显示，避免白画布一闪
                let win_for_show = win.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(140));
                    let _ = win_for_show.show();
                });
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
            read_progress
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
