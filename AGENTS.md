# AGENTS.md — vxapo-app

本文件面向在本仓库工作的**人**与 **AI**。核心只有一条：**格式不由人决定。**

---

## 1. 仓库布局（**先看这条，容易踩**）

本仓是 **Tauri + Vue** 混合仓库：

- **仓库根不是 Cargo 包**。Rust 侧在 `src-tauri/`，配置文件也在那里：
  - `src-tauri/rustfmt.toml`
  - `src-tauri/rust-toolchain.toml`
  - `src-tauri/Cargo.toml`
- 前端在 `src/`（Vue/TS），构建产物 `dist/`、依赖 `node_modules/` 均不入库。

因此所有 cargo 命令**必须带 `--manifest-path src-tauri/Cargo.toml`**（在根目录跑时）。
在 `src-tauri/` 里面跑则不需要。

---

## 2. 格式：`cargo fmt` 是唯一权威

- 风格配置在 `src-tauri/rustfmt.toml`（`style_edition = "2021"`、
  `newline_style = "Unix"`）。折行策略就是 rustfmt 默认值，**无任何自定义 width 参数**。
- 工具链钉在 `src-tauri/rust-toolchain.toml`（`channel = "1.97.1"`）。
- **不要手工微调格式**，也不要为局部观感引入新的格式化工具。
- 前端（Vue/TS）的缩进/行尾由 `.editorconfig` 管；**本计划未引入前端格式化器**
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
- **注意**：本仓 `.gitignore` 是 **GBK 编码**（不是 UTF-8），且 `.vscode/*` 原本被忽略。
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

当前有 2 类告警（`needless_borrows_for_generic_args`、`unnecessary if-let`）。
**这一状态在格式化之前就已存在**——已用 stash 回到 pre-fmt 状态实证，
pre-fmt 与 post-fmt 的错误集合完全一致，格式化未引入任何新 lint。

因此：**不要**把 clippy 通过当作本仓提交门槛；也不要在格式化任务里顺手大规模清理它。
