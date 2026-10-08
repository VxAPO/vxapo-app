/**
 * 一键 release：driver DLL + cli EXE 重编 → 拷入 app resources → tauri 打安装包。
 *
 * 用法（vxapo-app 下）：`npm run release`
 *
 * 分步等价物：
 *   1. cd ../vxapo-driver && cargo build --release
 *   2. cd ../vxapo-cli    && cargo build --release
 *   3. 拷 target/<triple>/release/{vxapo_driver.dll, vxapo-cli.exe} → src-tauri/resources/
 *   4. npx tauri build（beforeBuildCommand 的 npm run build 自带 TEMP 重定向）
 *
 * 产物查找按「三重 target 目录优先、退回 target/release」的顺序，
 * 兼容两个仓的 .cargo/config.toml 指定默认 target 与未指定的情况。
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = resolve(APP_DIR, "..");
const TRIPLE = "x86_64-pc-windows-msvc";

function run(cmdline, cwd) {
  console.log(`\n> [${cwd.replace(ROOT, ".")}] ${cmdline}`);
  const r = spawnSync(cmdline, { cwd, stdio: "inherit", shell: true });
  if (r.status !== 0) {
    console.error(`\n✗ 失败：${cmdline}（exit ${r.status}），release 中止`);
    process.exit(r.status ?? 1);
  }
}

function findArtifact(repo, name) {
  for (const p of [
    join(ROOT, repo, "target", TRIPLE, "release", name),
    join(ROOT, repo, "target", "release", name),
  ]) {
    if (existsSync(p)) return p;
  }
  return null;
}

// 1/2) 两个 Rust 组件重编（各自仓内跑，尊重各自的 .cargo/config）。
run("cargo build --release", join(ROOT, "vxapo-driver"));
run("cargo build --release", join(ROOT, "vxapo-cli"));

// 3) 拷贝进 app resources（tauri.conf.json bundle.resources 引用这两个路径）。
const resDir = join(APP_DIR, "src-tauri", "resources");
mkdirSync(resDir, { recursive: true });
for (const [repo, file] of [
  ["vxapo-driver", "vxapo_driver.dll"],
  ["vxapo-cli", "vxapo-cli.exe"],
]) {
  const src = findArtifact(repo, file);
  if (!src) {
    console.error(`✗ 找不到 ${repo} 的构建产物 ${file}（target 下没有 release 输出？）`);
    process.exit(1);
  }
  copyFileSync(src, join(resDir, file));
  console.log(`✓ resources/${file} ← ${repo}（构建于 ${statSync(src).mtime.toISOString()}）`);
}

// 4) 打包（vite 阶段的 TEMP 重定向已在 package.json build 里内置）。
run("npx tauri build", APP_DIR);

const version = JSON.parse(readFileSync(join(APP_DIR, "package.json"), "utf8")).version;
const installer = join(APP_DIR, "src-tauri", "target", "release", "bundle", "nsis", `VxAPO_${version}_x64-setup.exe`);
if (!existsSync(installer)) {
  console.error(`\n✗ 打包完成但找不到安装包：${installer}`);
  process.exit(1);
}
console.log(`\n✓ release 完成：${installer}`);
