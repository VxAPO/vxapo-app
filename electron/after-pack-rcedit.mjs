// 给打包出的 exe 设置 requireAdministrator：启动时由 Windows AppInfo 服务
// 提权，进程一创建就是管理员，CLI 子进程继承该令牌。
// 不能改 asInvoker——CLI 的 install/uninstall/stale fix-acl 都要写 HKLM。
// 与 main.mjs 的 VBS/pwsh 降级通道无关，那套只在 CLI 报权限不足时启用。
// rcedit 没有 --set-application-manifest，用 --set-requested-execution-level。
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
