#!/usr/bin/env node
// 从 driver 的效果器参数表生成 src/lib/effects.generated.ts（决策 2）。
//
// 用法：npm run sync:driver-schema
//   - cli 定位：优先 env VXAPO_CLI（指向已构建的 vxapo-cli.exe），
//     否则用 cargo run 跑 ../vxapo-cli（开发机最省事，无需先出二进制）。
//   - driver 改参数后手动重跑，生成物入库（不做构建钩子）。
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const cliManifest = resolve(repoRoot, "../vxapo-cli/Cargo.toml");
const outFile = resolve(repoRoot, "src/lib/effects.generated.ts");

function runCli() {
  const args = ["effects", "schema", "--json"];
  const envCli = process.env.VXAPO_CLI;
  if (envCli) {
    return execFileSync(envCli, args, { encoding: "utf8" });
  }
  return execFileSync(
    "cargo",
    ["run", "--quiet", "--manifest-path", cliManifest, "--", ...args],
    { encoding: "utf8" },
  );
}

const specs = JSON.parse(runCli().trim());
if (!Array.isArray(specs) || specs.length === 0) {
  throw new Error("effects schema 返回为空：检查 driver effect_param_specs() 与 cli effects 子命令");
}
const params = specs.reduce((n, e) => n + e.params.length, 0);

const body = `// 由 \`npm run sync:driver-schema\` 生成，请勿手改。
//
// 单一来源：vxapo-driver 的 \`pipeline/dsp/specs.rs\`（\`effect_param_specs()\`），
// 经 cli \`effects schema --json\` 透传。driver 改参数后重跑本脚本，生成物入库。
//
// 这里给的是 driver 的**权威数值**（范围/步进/精确默认值），不含 UI 显示精度：
// 输入框显示与「新增效果器的起点」由 effects.ts 自行取舍（见 UI_DEFAULT_PARAMS）。

/** 单个参数的可调范围、步进、driver 默认值与单位。 */
export type EffectParamSpec = {
  key: string;
  step: number;
  min: number;
  max: number;
  default: number;
  unit?: string;
};

/** 一种效果器及其全部 UI 可调参数（顺序即 UI 展示顺序）。 */
export type EffectSpec = { effect: string; params: EffectParamSpec[] };

export const EFFECT_PARAM_SPECS: EffectSpec[] = ${JSON.stringify(specs, null, 2)};
`;

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(outFile, body, "utf8");
console.log(`✓ ${outFile} ← ${specs.length} 个效果器 / ${params} 个参数`);
