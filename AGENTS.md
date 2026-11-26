# AGENTS.md — vxapo-app

本文件面向在本仓库工作的**人**与 **AI**。核心只有一条：**格式不由人决定。**

---

## 1. 仓库布局（**先看这条，容易踩**）

本仓是 **Tauri + React** 混合仓库：

- **仓库根不是 Cargo 包**。Rust 侧在 `src-tauri/`，配置文件也在那里：
  - `src-tauri/rustfmt.toml`
  - `src-tauri/rust-toolchain.toml`
  - `src-tauri/Cargo.toml`
- 前端在 `src/`（React/TS），构建产物 `dist/`、依赖 `node_modules/` 均不入库。

因此所有 cargo 命令**必须带 `--manifest-path src-tauri/Cargo.toml`**（在根目录跑时）。
在 `src-tauri/` 里面跑则不需要。

---

## 2. 格式：`cargo fmt` 是唯一权威

- 风格配置在 `src-tauri/rustfmt.toml`（`style_edition = "2024"`、
  `newline_style = "Unix"`）。折行策略就是 rustfmt 默认值，**无任何自定义 width 参数**。
- 工具链钉在 `src-tauri/rust-toolchain.toml`（`channel = "1.100.0"`）。
- **不要手工微调格式**，也不要为局部观感引入新的格式化工具。
- 前端（React/TS）的缩进/行尾由 `.editorconfig` 管；**本计划未引入前端格式化器**
  （prettier 等），不要顺手加。

### 本仓库实测过的 rustfmt 行为（复审 diff 时不要误判为逻辑改动）

`cargo fmt` 除调整空白外，还会做这几类**等价**的机械改动：

1. **删除文件开头的 UTF-8 BOM**（U+FEFF）。
2. **补齐多行构造的尾随逗号**。
3. **重排 `use` 列表与 `mod` 声明**（按字典序）。
4. **给单表达式分支加/去花括号**（如 `=> expr` 展开成 `=> { expr }`）。
5. **给尾表达式补分号**（如 `else { return }` → `else { return; }`）。

---

## 3. 提交前：必须通过格式检查

```sh
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check   # 退出码 0、无输出才算通过
```

**新克隆的机器必须先执行一次**（hook 不随 clone 传播）：

```sh
git config core.hooksPath .githooks
```

之后 `.githooks/pre-commit` 会自动执行上述检查，未格式化直接拒绝提交。

> 注：本仓 Rust 侧与 driver / cli **没有 path 依赖**，所以不存在
> 「格式化越界到别的仓库」的问题（cli 仓有这个坑，本仓没有）。

---

## 4. 纪律：fmt 提交必须纯净

**逻辑改动不得与格式化放进同一提交**——`.git-blame-ignore-revs` 依赖「这是纯格式化」
这一事实才能安全跳过。提交后把**完整** hash 追加进 `.git-blame-ignore-revs`，
并执行一次 `git config blame.ignoreRevsFile .git-blame-ignore-revs`。

---

## 5. 升级 rustc 的流程（**独立事件**）

1. 先单独完成升级并提交。
2. 升级后单独跑 `cargo fmt --manifest-path src-tauri/Cargo.toml`，若有变化：
   单独成 `style:` 提交 → 追加 hash 到 `.git-blame-ignore-revs` → 更新
   `src-tauri/rust-toolchain.toml`。
3. 无变化则只更新 `src-tauri/rust-toolchain.toml`。

> 三个 Rust 仓库钉同一版本，升级时 driver / cli / app 的 `rust-toolchain.toml` 要一起改。

---

## 6. 行尾与编辑器

- 行尾由 `.gitattributes` 统一为 **LF**（`*.cmd` / `*.bat` 例外保持 CRLF）。
  本仓该文件早已存在，本次只统一了注释文字。
- `.editorconfig` 管非 Rust 文件；`.vscode/settings.json` 已入库（保存即格式化）。
- **注意**：本仓 `.gitignore` 是**混合编码**（主体 GBK，第 28 行起混有 UTF-8 行），且 `.vscode/*` 原本被忽略。
  已补 `!.vscode/settings.json` 例外；**改动该文件时必须按字节处理，不要当成 UTF-8 重写**，
  否则会破坏其中的中文注释。

---

## 7. 质量基线

```sh
cargo test --manifest-path src-tauri/Cargo.toml    # 通过（当前 0 个测试，仅确认可编译）
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check   # 退出码 0
```

### ⚠️ clippy 当前**不是**绿的（既有问题，非格式所致）

```sh
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings   # 退出码 101
```

当前有 3 类告警，各 1 处：`needless_borrows_for_generic_args`、`manual_flatten`、
`collapsible_if`。
**这一状态在格式化之前就已存在**——已用 stash 回到 pre-fmt 状态实证，
pre-fmt 与 post-fmt 的错误集合完全一致，格式化未引入任何新 lint。

因此：**不要**把 clippy 通过当作本仓提交门槛；也不要在格式化任务里顺手大规模清理它。

---

## 8. 与 driver / cli 的关系

本仓 Rust 侧（`src-tauri/`）**不依赖** `vxapo-driver` 或 `vxapo-cli`——依赖只有
`tauri` / `tauri-plugin-*` / `serde` / `serde_json`。

三个仓库之间只通过**约定的数据契约**耦合（由 `vxapo-cli` 的 `protocol/` 子 crate
`vxapo-protocol` 定义，即 `--json` 输出结构）。

**这点对格式有实际影响**：因为本仓没有跨仓 path 依赖，
`cargo fmt --manifest-path src-tauri/Cargo.toml` **不会**越界改到别的仓库
（`vxapo-cli` 仓有这个坑，见其 AGENTS.md §2；本仓没有）。

> 若将来需要消费 driver/cli 的类型，**不要**直接加 path 依赖——那会把
> 「格式化越界」与「编译顺序耦合」一并引入。应经 `vxapo-protocol` 的契约。

## 9. 注释写作纪律

**注释只描述「现在是什么、为什么这样」，不描述「改过什么」。**

### 禁止

| 类别 | 例子 | 原因 |
|---|---|---|
| 修改过程 | 「改由 X 承载」「原样搬出」「踩过」「原来是 A，现改为 B」 | 属于提交信息，代码里是噪音 |
| 外部编号 | 「决策 4 阶段 A」「第 3 批」「Step 2」「UI 设计规范 05」 | 仓库内无定义可查 |
| 否定句式 | 「不能按窗口中心算」「无需提权」「不要用 X」 | 优先正向书面陈述 |
| 破折号 | 「……——……」 | 用句号或逗号断句 |
| 空话开场 | 「需要注意的是：」「这里说明一下：」 | 无信息量 |

### 改写示例

```
✗ 必须和 ResizeObserver 报的 contentRect.width 同一个盒模型。踩过：布局 effect 曾经用
  getBoundingClientRect().width（含 padding），两者差 36px，表现为坐标轴细微水平抖动。
✓ 必须和 ResizeObserver 报的 contentRect.width 同一个盒模型。getBoundingClientRect().width
  含 padding，两者差 36px，会导致坐标轴细微水平抖动。

✗ 选中集与工具栏联动改由 selectionStore 承载。
✓ 选中集与工具栏联动由 selectionStore 承载。

✗ 不能按窗口中心算。
✓ 按窗口中心算会偏，须用左右按钮簇的实际宽度。
```

### 例外

- **性能数据**（「实测 p50 从 3.5ms 涨到 14.4ms」）保留，这是依据不是过程。
- **约束说明**（「必须…否则…」）保留，这是规则。
- 分隔线注释与 `src/lib/generated/` 下的生成文件跳过检查。

### 检查

```sh
node scripts/check-comments.mjs .          # 全仓检查
node scripts/check-comments.mjs src/       # 只查某个目录
```

退出码 1 表示有违规。pre-commit 钩子会自动执行，未通过则拒绝提交。