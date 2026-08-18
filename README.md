# VxAPO App

A Windows APO tuning application similar to Equalizer APO, built with Rust + Tauri.

## Highlights

- Browser-like page design: each device is a tab; add or close tabs for per-device tuning.
- Fully decoupled from the audio plugin: the app only registers APO slots during install and only writes `C:\ProgramData\VxAPO\{GUID}\config.toml`.
- The DLL runs inside `audiodg` and hot-reloads config changes through directory monitoring.
- Two views:
  - **Semantic view**: turns audio parameters into understandable objects and preset groups.
  - **Parameter view**: exposes full control for advanced users.
- Per-device on/off and per-filter on/off.
- Built-in effects: MS-based stereo widening, harmonic excitation, plate reverb, auto gain, loudness compensation, and flexible reference-level calibration with auto-normalized curves.
- Card-based tuning list with clear types and parameters; sliders and input boxes for every value.
- Active channel selector: tune each channel independently, passthrough unset channels, and copy cards across channels.
- Stepless PEQ with 1–31 bands per block.
- Real-time frequency response curve with hover tooltip showing frequency and gain.
- Preset groups in semantic view; group deletion and marquee selection; full customization in parameter view.

## Build

```bash
npm install
npm run tauri dev
npm run tauri build
```

## Documentation

See `../vxapo-docs` for project documentation.

## License

GPL-3.0-or-later

---

# VxAPO App

一款类似 Equalizer APO 的 Windows APO 调音软件，技术栈为 Rust + Tauri。

## 特点

- 类似浏览器的页面设计：每个设备是一个标签页，通过添加/关闭标签页进行逐设备调音管理。
- 音频插件与 App 完全解耦：App 只在安装时注册设备 APO 槽位，只修改 `C:\ProgramData\VxAPO\{GUID}\config.toml`。
- DLL 注入 `audiodg`，具备目录监控、热重载解析 config 的能力。
- 双视图：
  - **语义视图**：将音频参数转换为可描述的对象与预设卡组。
  - **参数视图**：将完整权限开放给高级用户。
- 支持逐设备开关（标签页）和逐滤波器开关（卡片头）。
- 自研效果器：基于 MS 算法的声场加宽、谐波激励、板式混响、自动增益、等响曲线补偿、灵活的基准电平调节。
- 调音以卡片列表形式呈现，注明类型和参数；参数均以滑块和输入框实现。
- 主动通道选择器：可逐通道独立调音，未设置的通道 passthrough，并可将卡片复制到指定声道。
- 支持 1 到 31 段无极 PEQ 调节。
- 界面下方显示频响曲线，鼠标悬停显示对应频率和增益。
- 预设卡组支持按组管理、按组删除、框选删除部分；参数视图可自定义调节。

## 构建

```bash
npm install
npm run tauri dev
npm run tauri build
```

## 文档

项目文档见 `../vxapo-docs`。

## 许可证

GPL-3.0-or-later
