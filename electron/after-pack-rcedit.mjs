// electron-builder afterPack：给打包出的 exe 设置 requireAdministrator。
// 本机 UAC 配置为「静默提权」（ConsentPromptBehaviorAdmin=0），应用常驻管理员即可
// 跳过整条 runas 提权管道（该管道在此配置下会无声失败）。
// 注意：rcedit 没有 --set-application-manifest（会报 Unrecognized argument），
// 用它原生的 --set-requested-execution-level；打包阶段 exe 尚未签名，提交无障碍。
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rcedit = path.join(
  __dirname,
  "..",
  "node_modules",
  "rcedit",
  "bin",
  "rcedit-x64.exe",
);

export default async function afterPack(context) {
  const exe = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.exe`,
  );
  execFileSync(rcedit, [
    exe,
    "--set-requested-execution-level",
    "requireAdministrator",
  ]);
  console.log(`afterPack: requireAdministrator 已嵌入 ${exe}`);
}
