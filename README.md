# VxAPO App

一款类似 Equalizer APO 的 Windows APO 调音软件，技术栈为 Rust（Tauri 2）+ React 19。

## 特点

- 类似浏览器的页面设计：每个设备是一个标签页，通过添加/关闭标签页进行逐设备调音管理；
  标签页左侧圆点开关逐设备启用/停用整链（初次打开即按磁盘状态显示）。
- 音频插件与 App 完全解耦：App 只在安装时经 CLI 注册设备 APO 槽位，只写
  `C:\ProgramData\VxAPO\{GUID}\config.toml`；DLL 注入 `audiodg`，事件驱动热重载。
- 双视图：
  - **语义视图**：把音频参数转换为可理解的强度与预设卡组，按感知量调节。
  - **参数视图**：将完整参数开放给高级用户，滑块 + 输入框覆盖每个值。
- 内置效果器：基准电平、声场处理（M/S + 空气吸收 + 动态侧增益）、谐波激励、
  板式混响（Dattorro）、压缩器、等响补偿（ISO 226）。
- 语义强度映射：干湿交叉淡化（`wet ≤ 0.9`、`dry = 1 - wet`，和 ≤ 1 防削波），
  reverb 强度联动尾长/阻尼/预延迟/房间大小，wide 强度=中置距离（空气吸收深度）。
- 主动通道选择器：可逐通道独立调音，未设置的通道 passthrough，并可将卡片复制到指定声道。
- 支持 1 到 31 段 PEQ（`fc<200Hz` IIR / `≥200Hz` 线性相位 FIR 由 driver 自动分配）。
- 界面下方实时频响曲线（拖动时 42ms 节流重算保帧数），悬停显示频率与增益。
- 预设/自定义卡组支持按组管理、框选批量删除、保存为自定义预设（组名 + 每段语义描述）。
- 自绘 overlay 滚动条：不占布局宽度、只在真实滚动时出现、停止滚动自动淡出。

## 与 Driver 的行为对齐

- **配置契约**：`version=1` / `enabled` / `[meta]` / `[[effects]]`；PEQ 块固定写
  `crossover_hz = 200`；`channels` 声明作用声道；`name` / `group` 为 UI 元数据，
  driver 忽略（改名不触发 DSP 重建）。
- **效果器参数**：参数键与默认值与 driver 完全一致；语义强度写回的核心参数
  （如 reverb 的 decay/damping/room_size）同样遵循 driver 边界。
- **限幅**：写回时按 driver 数值边界主动限幅（增益 `[-120,+48]`、滤波深切地板 -60、
  NaN/inf 拒绝、31 段上限）；driver 只在内存 clamp、从不回写。
- **安装/卸载**：App 后端提权调用 `vxapo-cli install --verify`（进度事件流式展示），
  失败有 `rollback_install` 兜底；App 自身不写注册表。
- **热重载**：App 2s 轮询外部变更同步 UI（编辑中跳过）；driver 事件驱动热重载，
  spec 指纹相同则幂等。

## 构建

```bash
npm install
npm run tauri dev
npm run tauri build
```

Windows 发布构建（含 exe 图标重嵌入）：

```bash
npm run build:win
```

## 文档

项目文档见 `../vxapo-docs`，App 引用规范见 `../vxapo-docs/app`。

## 致谢 Equalizer APO

VxAPO 的设计参考了 [Equalizer APO](https://sourceforge.net/projects/equalizerapo/)：
逐设备 APO 槽位安装、配置文件驱动 DSP、31 段 GraphicEQ 上限、事件驱动热重载等。
本应用为独立实现，不包含 Equalizer APO 代码。Equalizer APO © Jonas Thedering，GPL-2.0。

## 许可证

GPL-3.0-or-later

---

# VxAPO App

A Windows APO tuning application similar to Equalizer APO, built with Rust (Tauri 2) +
React 19.

## Highlights

- Browser-like page design: each device is a tab; add or close tabs for per-device
  tuning; the dot switch on each tab enables/disables the whole chain (initialized
  from disk state).
- Fully decoupled from the audio plugin: the app only registers APO slots through the
  CLI during install and only writes `C:\ProgramData\VxAPO\{GUID}\config.toml`; the DLL
  runs inside `audiodg` and hot-reloads config through event-driven directory monitoring.
- Two views:
  - **Semantic view**: turns audio parameters into understandable strengths and preset
    groups.
  - **Parameter view**: exposes full control for advanced users; sliders and input
    boxes for every value.
- Built-in effects: preamp (reference level), stereo field (M/S + air absorption +
  dynamic side gain), harmonic excitation, plate reverb (Dattorro), compressor, and
  loudness compensation (ISO 226).
- Semantic strength mapping: dry/wet crossfade (`wet ≤ 0.9`, `dry = 1 - wet`, sum ≤ 1 to
  avoid clipping); reverb strength links decay/damping/pre-delay/room size; wide strength
  equals center distance (air absorption depth).
- Active channel selector: tune each channel independently, passthrough unset channels,
  and copy cards across channels.
- Stepless PEQ with 1–31 bands per block (IIR below 200 Hz / linear-phase FIR at or
  above 200 Hz, assigned automatically by the driver).
- Real-time frequency response curve (42 ms throttled recompute while dragging) with a
  hover tooltip showing frequency and gain.
- Preset/custom groups with group management, marquee batch deletion, and saving
  custom presets (group name + per-band semantic descriptions).
- Custom overlay scrollbar: takes no layout width, appears on genuine scrolling only,
  auto-fades when idle.

## Alignment with the Driver

- **Config contract**: `version=1` / `enabled` / `[meta]` / `[[effects]]`; PEQ blocks
  always carry `crossover_hz = 200`; `channels` declares the scope; `name` / `group` are
  UI metadata ignored by the driver (renaming does not rebuild DSP).
- **Effect parameters**: keys and defaults match the driver; semantic write-back values
  (e.g., reverb decay/damping/room_size) respect the same bounds.
- **Clamping**: write-side clamping follows driver bounds (gain `[-120,+48]`, deep-cut
  floor -60, NaN/inf rejected, 31-band limit); the driver clamps in memory only and
  never writes back.
- **Install/uninstall**: the backend invokes `vxapo-cli install --verify` elevated
  (streamed progress events), with `rollback_install` fallback on failure; the app
  never writes the registry itself.
- **Hot reload**: the app polls external changes every 2 s to sync the UI (skipped
  while editing); the driver reloads on file events, idempotent via spec fingerprints.

## Build

```bash
npm install
npm run tauri dev
npm run tauri build
```

Windows release build (includes exe icon re-embedding):

```bash
npm run build:win
```

## Documentation

See `../vxapo-docs`, with the app reference under `../vxapo-docs/app`.

## Acknowledgments: Equalizer APO

VxAPO's design is inspired by [Equalizer APO](https://sourceforge.net/projects/equalizerapo/):
per-device APO slot installation, config-file-driven DSP, the 31-band GraphicEQ limit,
and event-driven hot reload. This app is an independent implementation with no
Equalizer APO code. Equalizer APO © Jonas Thedering, GPL-2.0.

## License

GPL-3.0-or-later
