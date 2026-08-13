use std::path::Path;
use std::process::Command;

/// vxapo-cli 路径：env VXAPO_CLI 优先，缺省开发机固定路径。
fn cli_path() -> String {
    std::env::var("VXAPO_CLI").unwrap_or_else(|_| {
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

/// 设备列表（CLI list --json，UI 设计规范 05）。
#[tauri::command]
fn list_devices() -> Result<String, String> {
    let out = Command::new(cli_path())
        .args(["list", "--json"])
        .output()
        .map_err(|e| format!("CLI 启动失败：{e}"))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![write_config, read_config, list_devices])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
