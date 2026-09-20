// VxAPO 契约类型（由 vxapo-cli/protocol 生成，勿手改）。
//
// 重新生成：
//   cd vxapo-cli
//   TS_RS_EXPORT_DIR=../../vxapo-app/src/lib/generated cargo test -p vxapo-protocol export_bindings
//
// 字段即 CLI `--json` 契约，单一来源在 vxapo-cli/protocol/src/lib.rs；app 侧
// model.ts / api.ts 只做 re-export，不再维护第二份手写定义。
export type { CliError } from "./CliError";
export type { CliOk } from "./CliOk";
export type { Device } from "./Device";
export type { DeviceKind } from "./DeviceKind";
export type { DeviceSlots } from "./DeviceSlots";
export type { InstallProgressEvent } from "./InstallProgressEvent";
export type { MigrationReport } from "./MigrationReport";
export type { ServiceAction } from "./ServiceAction";
export type { StaleInstall } from "./StaleInstall";
export type { StaleMatchedBy } from "./StaleMatchedBy";
export type { StaleTargetState } from "./StaleTargetState";
