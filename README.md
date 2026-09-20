# VxAPO App

<!-- 徽章区（待补）：CI 状态 · 许可证 · 最近发布 -->

[中文](#vxapo-app) · [English](#vxapo-app-english) · [项目总览](../vxapo-docs/overview/zh/项目概览.md)

VxAPO App 是 VxAPO 的桌面调音端，技术栈为 Rust（Tauri 2）与 React 19。它把 driver 的能力
实现为一套图形交互界面：多设备并行调音、两种调音视图、卡片级开关与预设卡组，改动即时生效。

阅读顺序：定位与边界 → 两种调音视图 → 调音交互 → 预设卡组 → 界面、主题与视觉语言 →
前端架构 → 与 Driver 的边界 → 上手与开发 → 实现约定 → 参考。

## 1 · 定位与边界

| App 负责 | App 不负责 |
|---|---|
| 多设备并行调音与图形交互 | 注册表写入（一律经提权 CLI） |
| 语义视图与参数视图 | APO 槽位模式选择（driver `install/selector`） |
| 写入每设备的 `config.toml` | 音频处理（driver DLL 在 `audiodg` 内运行） |
| 从参数表生成界面（`npm run sync:driver-schema`） | 参数范围与默认值的定义（driver `effect_param_specs()`） |

## 2 · 两种调音视图

同一份配置有两个调音视图。两者不是简化版与完整版的关系。切换不受限制，因为两条路径写入的是
同一批 driver 参数。

| 视图 | 面向 | 你看到的 |
|---|---|---|
| **语义视图** | 不需要接触音频参数 | 把 driver 参数换算成强度与预设卡组，按感知量调节，例如低频厚度、声场宽度 |
| **参数视图** | 熟悉音频参数 | 参数本来的样子：频率、增益、Q，压缩器的阈值与比率等。每个值都有滑块与输入框 |

两套视图共用同一批卡片位置与开关状态。语义视图改动强度时，写入的是同一批 driver 参数，
因此两条路径随时互切、不会产生两套配置。

## 3 · 调音交互：逐设备 · 逐声道 · 逐卡片

| 粒度 | 操作 |
|---|---|
| 逐设备 | 每个设备一个标签页，可添加与关闭。标签页左侧圆点一键启用或停用整链，初值按磁盘状态显示 |
| 逐声道 | 通道选择器支持逐通道独立调音。未设置的通道 passthrough。选中的卡片可复制到指定声道 |
| 逐卡片 | 每张卡自带开关（语义卡与参数卡一致），可单独关闭一个效果而不影响其它卡片；效果项也可单独切换 |
| 批量 | 框选多张卡片批量删除，或将选中的卡片保存为预设 |

### 3.1 PEQ 段数：无级段数，两种上限口径

**段数无级**：1–31 之间任意数量都可用，界面不设固定档位（不是「10 段 / 15 段 / 31 段」这种
预置档）。上限的口径由通道选择器决定。

| 通道选择器 | 生效的块 | 上限 | 界面反馈 |
|---|---|---|---|
| 关闭 | 整台设备一个块（声道未声明） | **整设备 31 段** | 超限提示「最多 31 段，当前 N 段，添加 M 段将超限」 |
| 开启 | 每个声道各一个块 | **每个声道 31 段** | 超限提示「该声道最多 31 段，已达到上限」；设备属性卡按声道分别列出段数 |

因此开启通道选择器后，**设备总段数可以超过 31**：例如 L 20 段 + R 20 段。把卡片复制到某个声道
时，按**目标声道**判断是否超限。

## 4 · 预设卡组

- **内置预设库**：按组编排（`src/data/library.ts`）。条目中英成对，界面切换语言时按语言回退。
- **使用标记**：已使用的预设带标记，避免重复叠加。
- **保存自定义**：从选中的卡片保存为一个预设。可填名称、描述、颜色，并为每一段写语义描述。
  自定义预设保存在本机。
- **删除**：自定义预设可删除，内置预设不可删。

## 5 · 界面、主题与视觉语言

本章列出界面视觉的实现约定，共四类手段：浏览器式交互、胶囊形几何、背景模糊、边缘染色。
下列数值均可在 `src/styles/` 中查到。

### 5.1 圆角与轮廓形状

轮廓分两类，二者不混用：

- **可交互控件用胶囊形**：半径取高度的二分之一（写作 `9999px`），两端为半圆。
- **容器用圆角矩形**：四角为等半径圆弧，弧心到相邻两条边等距。半径按容器层级取固定档位，
  同一层级共用一档，因此界面各处的弧边在视觉上一致。半径不随容器尺寸按比例缩放。按比例缩放
  会使大容器的四角显得更软，一致性随之消失。

| 适用对象（由外到内） | 半径 | 定义位置 |
|---|---|---|
| 侧栏、设备卡片、内容区（最外层容器） | 26 px | `sidebar.css`、`device.css` |
| 卡片、工具栏、标签页 | 16 px | `curve.css`、`drag.css`、`device.css`、`tabs.css` |
| 浮层内块、下拉、对话框分区 | 14 px | `drag.css`、`dialogs.css` |
| 列表块 | 12 px | `drag.css` |
| 搜索框、小输入框 | 8–10 px | `device.css` |
| 分段控件、标签、按钮、Toast、进度条、滚动条（**胶囊**） | `9999px` | `topbar.css`、`toast.css`、`dialogs.css`、`overlay-scroll.css` |

### 5.2 背景模糊

统一形式为 `backdrop-filter: blur() saturate() [contrast() brightness()]`。参数按背景内容分
别设定，不使用统一值。

| 适用位置 | 参数 | 设定依据 |
|---|---|---|
| 浅色主题的卡片与工具栏 | `blur(10–12px) saturate(1.05) contrast(0.55) brightness(1.38)` | 提高背景采样的亮度并降低对比，使背景的暗部与彩色噪点不影响面板底色 |
| 深色主题的同类面板 | `blur(8px) saturate(1.15)` | 深色主题的对比度本身较低，仅需小幅提高饱和度 |
| 深色主题的高光层与边缘层 | `blur(24–36px) saturate(2.4–3)` | 边缘层的采样范围较大，需要更大的模糊半径与更高的饱和度 |
| 下拉与右键菜单 | `blur(var(--blur-md))` / `blur(var(--blur-sm))` | 使用 token，随主题过渡 |
| 主题切换期间 | `backdrop-filter` 参与 0.55 s 过渡 | 模糊半径不参与过渡时，切换过程出现跳变 |

### 5.3 边缘染色

染色值不硬编码，由背景派生。

- **边缘 token**：`--ring-g1/g2/s1/s2/l/r/t/m/b/base` 与 `--edge-shade`，浅色与深色各一组
  （浅色 `--ring-g1: 0.42`、`--ring-base: rgba(217,222,231,.25)`，深色 `--ring-g1: 0.16`、
  `--ring-base: rgba(255,255,255,.035)`）。全部随主题做 0.35 s 插值。
- **面板底色**：使用 `color-mix(in srgb, var(--card) 78%, transparent)` 一类合成，不使用固定
  灰值。
- **描边来源**：卡片声明 `border: 1px solid transparent`，描边由外侧边缘层提供，因此颜色随
  背景内容变化。
- **层序约束**：外层 `.fx` 不声明 `backdrop-filter`。边缘层挂在该外层上，采样对象是面板背后
  的内容，不是卡片内部（`curve.css` 对此有注释）。
- **代码位置**：`lib/edgetint/geometry.ts` 提供颜色、亮度、环形描边等纯函数。
  `hooks/useEdgeTintLayer.ts` 负责挂载 `startAuto`、卸载 `stopAuto`，多挂载点用引用计数。

### 5.4 主题与过渡

`theme.css` 使用 `@property` 注册三十余个颜色 token 为可插值属性（`syntax: '<color>'`），并在
`transition` 中逐个列出。注册是整页同步渐变的前提：未注册的自定义属性在过渡中跳变。
`hooks/useTheme.ts` 负责三态（浅色 / 深色 / 跟随系统）、`data-theme` 切换、`theme-transition`
类的 420 ms 窗口，以及本机记忆。

### 5.5 浏览器式控件

- **设备标签页**：`tabs.css` 为每页提供标题、关闭按钮、状态圆点与选中底色。
- **分段控件与胶囊**：`topbar.css` 的 `.seg`（`inline-flex` 轨道 + 胶囊滑块）与 `.pill`。
- **滚动条**：`overlay-scroll.css` 使用独立浮层绘制 5 px 胶囊。它不占布局宽度，仅在滚动期间
  显示，停止后淡出。
- **浮层**：下拉、右键菜单与对话框统一经 `AppOverlays`，共用同一套模糊与半径。

### 5.6 WebView2 依赖

`@property`、`color-mix()`、`mask-composite`、`backdrop-filter`、`-webkit-scrollbar` 均为
Chromium 系能力。Windows 端 Tauri 2 通过 WebView2 渲染，因此可直接使用上述特性，无需为其它
渲染器提供降级路径。

### 5.7 其余界面细节

- **实时频响曲线**：拖动时按 42 ms 节流重算（`THROTTLED_COMPUTE_MS`，约 24 fps），停止后补算
  一次。悬停显示频率与增益。
- **可访问性**：卡片开关键带 `aria-pressed` 与中英标签，图标按钮都带 `title`。

## 6 · 前端架构

| store | 职责 |
|---|---|
| `stores/deviceStore` | 设备列表、残留安装、卸载 |
| `stores/configStore` | 配置状态机，含通道基准电平拆分与整链增益归一化 |
| `stores/channelStore` | 通道选择，逐设备记忆 |
| `stores/selectionStore` | 选中集与工具栏联动 |
| `stores/uiStore` | 错误条、Toast、对话框开关 |

组件按需订阅，`App.tsx` 只做编排与视图动画。

| 组件 | 职责 |
|---|---|
| `ViewStage` | 视图舞台 |
| `AppOverlays` | 应用级浮层：六个对话框、拖拽层、Toast |
| `NoDeviceHint` | 空态提示 |
| `MarqueeBox` | 框选框 |
| `PresetView` / `AdvancedView` | 两个主视图。只接收动画、选中与拖拽类 props（分别 5 个与 6 个），配置与通道数据自行订阅 |

另外两条结构性事实：

- **参数单一来源**：`lib/effects.generated.ts` 由 driver 参数表生成（见 §8）。界面只维护参数
  文案与「新增效果器的起点」，范围、步进与默认值一律取自生成表。
- **边缘染色**：`lib/edgetint/geometry.ts` 提供颜色、亮度、环形描边等纯函数。
  `hooks/useEdgeTintLayer.ts` 在挂载时 `startAuto`、卸载时 `stopAuto`，多挂载点用引用计数。

## 7 · 与 Driver 的边界

| 事项 | 约定 |
|---|---|
| 配置契约 | `version=1` / `enabled` / `[meta]` / `[[effects]]`。PEQ 块固定写 `crossover_hz = 200`。`channels` 声明作用声道。`name` / `group` 是 UI 元数据，driver 忽略，因此改名不触发 DSP 重建 |
| 效果器参数 | 参数键与默认值与 driver 一致。语义强度写回的核心参数（如 reverb 的 decay / damping / room_size）同样遵守 driver 的边界 |
| 限幅 | 写回时按 driver 边界主动限幅：增益 `[-120,+48]`、滤波深切地板 -60 dB、拒绝 NaN/inf、段数上限（见 §3.1）。driver 只在内存 clamp，从不回写 |
| 安装 / 卸载 | 后端提权调用 `vxapo-cli install --verify`，进度事件流式展示。失败时 `rollback_install` 兜底，它改调 `vxapo-cli uninstall` 清除已写入的注册表配置。App 自身不写注册表 |
| 外部变更同步 | App 轮询磁盘变更同步界面（间隔 2 s，仅在当前设备已打开且轮询未暂停时启用，编辑中跳过）。driver 侧事件驱动热重载，`spec` 指纹相同则幂等跳过 |

## 8 · 上手与开发

```bash
npm install
npm run tauri dev            # 开发
npm run tauri build          # 构建
npm run build:win            # Windows 发布构建（含 exe 图标重嵌入）
```

```bash
npm test                     # vitest：TOML 往返 / 参数表一致性 / 预设库契约 / i18n 查表
npm run sync:driver-schema   # 用 driver 参数表重新生成 src/lib/effects.generated.ts
```

`sync:driver-schema` 调用 CLI 的 `effects schema --json`。CLI 的定位顺序：先看 `VXAPO_CLI`
环境变量，再看 App 同目录，最后看 `resources\vxapo-cli.exe`。

## 9 · 两条实现约定

- **错误码跨 IPC**：`src-tauri` 只传结构化错误码（`E_TIMEOUT` / `E_ELEVATION` /
  `E_CLI_SPAWN` / `E_INSTALL_*` 等）。带详情时写成 `E_Xxx: 详情`。前端按码走 i18n 取文案。
  CLI 自己输出的错误文本原样透传。
- **配置解析**：使用 `smol-toml`。畸形 TOML 会放弃解析，并把原文放进 `tail`。保存时原样写回，
  因此不破坏用户文件。旧的手写解析器会静默吞掉半张表。

## 10 · 设计参考与致谢

本项目参考了 [Equalizer APO](https://sourceforge.net/projects/equalizerapo/) 的以下做法：
逐设备 APO 槽位安装、以配置文件驱动 DSP、31 段 GraphicEQ 上限、事件驱动热重载。本应用是
独立实现，不含 Equalizer APO 代码。Equalizer APO © Jonas Thedering，GPL-2.0。

## 文档与许可

- 项目文档见 [`../vxapo-docs`](../vxapo-docs)，App 引用规范见
  [`../vxapo-docs/app`](../vxapo-docs/app)。
- 许可证：GPL-3.0-or-later。

---

<a id="vxapo-app-english"></a>

# VxAPO App

<!-- Badges (TODO): CI status · license · latest release -->

[中文](#vxapo-app) · [English](#vxapo-app-english) · [Project overview](../vxapo-docs/overview/en/Project%20Overview.md)

VxAPO App is the desktop tuning client for VxAPO, built with Rust (Tauri 2) and React 19. It
presents the driver's capabilities as a graphical interface: tune several devices side by
side, switch between two tuning views, toggle single cards, and reuse preset groups. Every
change takes effect immediately.

Reading order: scope and boundaries → two tuning views → tuning interaction → preset groups →
interface, themes and visual language → frontend architecture → boundaries with the Driver →
getting started and development → implementation conventions → references.

## 1 · Scope and boundaries

| The App owns | The App does not own |
|---|---|
| Per-device tuning and the graphical workflow | Registry writes. These always go through the elevated CLI |
| The semantic view and the parameter view | APO slot mode selection (driver `install/selector`) |
| Writing the per-device `config.toml` | Audio processing. The driver DLL runs inside `audiodg` |
| Generating the interface from the parameter table (`npm run sync:driver-schema`) | Parameter ranges and defaults (driver `effect_param_specs()`) |

## 2 · Two tuning views

One configuration has two tuning views. They are not a simplified version and a full version.
You can switch at any time, because both views write the same driver parameters.

| View | For | What you see |
|---|---|---|
| **Semantic view** | Users who do not want to handle audio parameters | The App converts driver parameters into strengths and preset groups for adjustment by perceived amount, such as low-end weight or stereo width |
| **Parameter view** | Users who know audio parameters | Parameters as they are: frequency, gain and Q, compressor threshold and ratio, and so on. Every value has a slider and an input box |

Both views share the same card positions and toggle states. When the semantic view changes a
strength, it writes the same driver parameters. The two routes therefore stay interchangeable
and never produce two configurations.

## 3 · Tuning interaction: per device, per channel, per card

| Granularity | Actions |
|---|---|
| Per device | Each device is a tab that you can add and close. The dot switch on the left toggles the whole chain, and it starts from the on-disk state |
| Per channel | The channel selector tunes each channel independently. Unset channels pass through. You can copy selected cards to a chosen channel |
| Per card | Every card has its own switch (semantic and parameter cards alike), so you can disable one effect without touching other cards. Individual effects toggle as well |
| Batch | Marquee-select several cards to delete them together, or save them as a preset |

### 3.1 PEQ band count: stepless, with two limit scopes

The band count is **stepless**. Any number from 1 to 31 is available, and the App applies no
fixed ladder of preset counts such as 10, 15 or 31 bands. The channel selector decides the
scope of the limit.

| Channel selector | Active blocks | Limit | Interface feedback |
|---|---|---|---|
| Off | One block for the whole device (no channel declared) | **31 bands for the device** | "Max 31 bands, currently N, adding M would exceed" |
| On | One block per channel | **31 bands per channel** | "This channel already has 31 bands". The device properties card lists the count for each channel |

With the channel selector on, the **device total can exceed 31**. For example, L with 20 bands
plus R with 20 bands passes. Copying cards to a channel checks the **target** channel.

## 4 · Preset groups

- **Built-in preset library**: organised by group (`src/data/library.ts`). Entries come in
  English and Chinese pairs, and the App falls back by language when you switch the UI.
- **Usage marks**: the App marks presets that are already in use, so you avoid stacking one twice.
- **Saving custom presets**: save the selected cards as one preset. You can set a name, a
  description and a color, and write a semantic description for each band. Custom presets
  stay on the local machine.
- **Deleting**: custom presets are deletable. Built-in presets are not.

## 5 · Interface, themes and visual language

This section lists the visual implementation conventions. Four techniques apply: browser-style
interaction, capsule geometry, backdrop blur and edge tinting. Every value below lives in
`src/styles/`.

### 5.1 Corners and outline shapes

Outlines fall into two families, and the two families do not mix:

- **Interactive controls use a capsule**: the radius is half the height (written as `9999px`),
  so both ends are semicircles.
- **Containers use a rounded rectangle**: the four corners are equal arcs, and each arc centre
  is equidistant from its two neighbouring edges. The radius takes a fixed step per container
  tier, and one tier shares one step, so corners read the same across the interface. The radius
  does not scale with container size. Proportional scaling makes the corners of a large
  container look softer and breaks that consistency.

| Applies to (outermost first) | Radius | Defined in |
|---|---|---|
| Sidebar, device card, content area (outermost containers) | 26 px | `sidebar.css`, `device.css` |
| Cards, toolbars, tabs | 16 px | `curve.css`, `drag.css`, `device.css`, `tabs.css` |
| Blocks inside overlays, dropdowns, dialog sections | 14 px | `drag.css`, `dialogs.css` |
| List blocks | 12 px | `drag.css` |
| Search field, small input fields | 8–10 px | `device.css` |
| Segmented control, tags, buttons, toast, progress bar, scrollbar (**capsules**) | `9999px` | `topbar.css`, `toast.css`, `dialogs.css`, `overlay-scroll.css` |

### 5.2 Backdrop blur

The form is always `backdrop-filter: blur() saturate() [contrast() brightness()]`. The App sets
the parameters per backdrop, and it does not use one value everywhere.

| Applies to | Parameters | Basis for the values |
|---|---|---|
| Cards and toolbars in the light theme | `blur(10–12px) saturate(1.05) contrast(0.55) brightness(1.38)` | Raises the luminance of the sampled backdrop and lowers contrast, so shadow and colored noise behind the panel do not affect the panel color |
| The same panels in the dark theme | `blur(8px) saturate(1.15)` | The dark theme already has low contrast, so a small saturation lift is sufficient |
| Highlight and edge layers in the dark theme | `blur(24–36px) saturate(2.4–3)` | The edge layer samples a wide area, so it needs a larger blur radius and higher saturation |
| Dropdown and context menus | `blur(var(--blur-md))` and `blur(var(--blur-sm))` | Token values, so they animate with the theme |
| During a theme switch | `backdrop-filter` joins the 0.55 s transition | Without interpolation of the blur radius, the switch shows a jump |

### 5.3 Edge tinting

The App derives tint values from the backdrop and hard-codes none of them.

- **Edge tokens**: `--ring-g1/g2/s1/s2/l/r/t/m/b/base` plus `--edge-shade`, with one set per
  theme. The light theme uses `--ring-g1: 0.42` and `--ring-base: rgba(217,222,231,.25)`. The
  dark theme uses `--ring-g1: 0.16` and `--ring-base: rgba(255,255,255,.035)`. All of them
  interpolate over 0.35 s with the theme.
- **Panel fills**: the App composes them with `color-mix(in srgb, var(--card) 78%, transparent)`
  and similar, and it uses no fixed gray.
- **Border source**: a card declares `border: 1px solid transparent`. The outer edge layer
  supplies the border, so the color follows the backdrop.
- **Layer-order constraint**: the outer `.fx` frame declares no `backdrop-filter`. The edge
  layer attaches to that frame and samples the content behind the panel, not the card interior.
  `curve.css` documents this constraint.
- **Where the code lives**: `lib/edgetint/geometry.ts` holds pure helpers for color, luminance
  and ring strokes. `hooks/useEdgeTintLayer.ts` calls `startAuto` on mount and `stopAuto` on
  unmount, and it ref-counts across its mount points.

### 5.4 Theme and transition

`theme.css` registers more than thirty color tokens as interpolable properties with `@property`
(`syntax: '<color>'`), then lists them one by one in `transition`. That registration is the
precondition for a synchronized fade of the whole page. A plain custom property jumps instead
of interpolating. `hooks/useTheme.ts` owns the three modes (light, dark and follow system), the
`data-theme` switch, the 420 ms `theme-transition` window, and the local memory of the choice.

### 5.5 Browser-style controls

- **Device tabs**: `tabs.css` gives each tab a title, a close button, a status dot and an
  active background.
- **Segmented control and capsule**: `.seg` in `topbar.css` (an `inline-flex` track with a
  capsule thumb) and `.pill`.
- **Scrollbar**: `overlay-scroll.css` draws a 5 px capsule in its own overlay. It takes no
  layout width, it appears only while the user scrolls, and it fades out when scrolling stops.
- **Overlays**: dropdowns, context menus and dialogs all go through `AppOverlays` and share one
  set of blur and radius values.

### 5.6 WebView2 dependency

`@property`, `color-mix()`, `mask-composite`, `backdrop-filter` and `-webkit-scrollbar` are
Chromium features. On Windows, Tauri 2 renders through WebView2, so the App uses these features
directly and ships no fallback path for a different renderer.

### 5.7 Further interface details

- **Real-time frequency response curve**: recomputed on a 42 ms throttle while dragging
  (`THROTTLED_COMPUTE_MS`, about 24 fps), plus one final recompute after the drag stops. A
  hover tooltip shows frequency and gain.
- **Accessibility**: each card switch carries `aria-pressed` and a localized label, and every
  icon button has a `title`.

## 6 · Frontend architecture

| Store | Responsibility |
|---|---|
| `stores/deviceStore` | Device list, stale installs, uninstall |
| `stores/configStore` | Config state machine, including per-channel preamp splitting and whole-chain gain normalization |
| `stores/channelStore` | Channel selection, remembered per device |
| `stores/selectionStore` | Selection set and toolbar coupling |
| `stores/uiStore` | Error bar, toast, dialog flags |

Components subscribe as needed, and `App.tsx` only orchestrates and drives view animation.

| Component | Responsibility |
|---|---|
| `ViewStage` | View stage |
| `AppOverlays` | App-level overlays: six dialogs, drag layers, toast |
| `NoDeviceHint` | Empty state |
| `MarqueeBox` | Marquee rectangle |
| `PresetView` / `AdvancedView` | The two main views. They receive animation, selection and drag props only (5 and 6 of them). They subscribe to config and channel data themselves |

Two more structural facts:

- **Single parameter source**: `lib/effects.generated.ts` comes from the driver parameter
  table (see §8). The UI keeps parameter labels and the starting point for a new effect
  only. Ranges, steps and defaults always come from the generated table.
- **Edge tint**: `lib/edgetint/geometry.ts` holds pure helpers for color, luminance and ring
  strokes. `hooks/useEdgeTintLayer.ts` calls `startAuto` on mount and `stopAuto` on unmount,
  and it ref-counts across its multiple mount points.

## 7 · Boundaries with the Driver

| Item | Agreement |
|---|---|
| Config contract | `version=1` / `enabled` / `[meta]` / `[[effects]]`. PEQ blocks always carry `crossover_hz = 200`. `channels` declares the scope. `name` / `group` are UI metadata that the driver ignores, so a rename does not rebuild DSP |
| Effect parameters | Parameter keys and defaults match the driver. Semantic write-back values (reverb decay, damping, room_size and others) respect the same bounds |
| Clamping | The App clamps on write to driver bounds: gain `[-120,+48]`, a -60 dB deep-cut floor, NaN/inf rejected, and the band-count limit (see §3.1). The driver clamps in memory only and never writes back |
| Install / uninstall | The backend calls `vxapo-cli install --verify` elevated and streams progress events. On failure, `rollback_install` clears the registry config that the failed run wrote by calling `vxapo-cli uninstall`. The App never writes the registry itself |
| External change sync | The App polls for on-disk changes to sync the UI. The interval is 2 s. The App enables the poll only while a device is open and polling is not paused, and it skips the poll while you edit. The driver reloads on file events, and it skips identical content by spec fingerprint |

## 8 · Getting started and development

```bash
npm install
npm run tauri dev            # develop
npm run tauri build          # build
npm run build:win            # Windows release build (includes exe icon re-embedding)
```

```bash
npm test                     # vitest: TOML round trip, parameter-table consistency,
                             # preset-library contract, i18n lookup
npm run sync:driver-schema   # regenerate src/lib/effects.generated.ts from the driver table
```

`sync:driver-schema` calls the CLI's `effects schema --json`. The lookup order for the CLI is
the `VXAPO_CLI` environment variable first, then the App directory, then
`resources\vxapo-cli.exe`.

## 9 · Two implementation conventions

- **Error codes over IPC**: `src-tauri` sends structured error codes only (`E_TIMEOUT`,
  `E_ELEVATION`, `E_CLI_SPAWN`, `E_INSTALL_*` and others). With details, it writes
  `E_Xxx: detail`. The frontend maps a code through i18n. Error text produced by the CLI
  itself passes through unchanged.
- **Config parsing**: the App uses `smol-toml`. Malformed TOML aborts parsing and keeps the
  raw text in `tail`, which the App writes back verbatim on save. A user file therefore
  survives. The earlier hand-written parser dropped half a table without a message.

## 10 · Design references and acknowledgments

This project references the following practice from
[Equalizer APO](https://sourceforge.net/projects/equalizerapo/): per-device APO slot
installation, config-file-driven DSP, the 31-band GraphicEQ limit, and event-driven hot
reload. This app is an independent implementation and contains no Equalizer APO code.
Equalizer APO © Jonas Thedering, GPL-2.0.

## Documentation and license

- Project documentation: [`../vxapo-docs`](../vxapo-docs). App reference:
  [`../vxapo-docs/app`](../vxapo-docs/app).
- License: GPL-3.0-or-later.
