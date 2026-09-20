import { memo, useMemo, useState } from "react";
import { TriangleAlert } from "lucide-react";
import type { MigrationReport, StaleInstall } from "../lib/model";
import { t } from "../lib/i18n/core";
import ConfirmDialog from "./ConfirmDialog";

interface StaleInstallBannerProps {
  items: StaleInstall[];
  selectedGuid: string | null;
  busy: boolean;
  onMigrate: (
    from: string,
    to: string,
    configFrom?: string | null,
    snapshotFrom?: string | null,
  ) => Promise<MigrationReport | null>;
  onCleanup: (guid: string) => Promise<void>;
  onDone: (msg: string) => void;
}

function StaleInstallBanner({
  items,
  selectedGuid,
  busy,
  onMigrate,
  onCleanup,
  onDone,
}: StaleInstallBannerProps) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  // 候选集：优先命中当前选中设备；当前设备没有残留时回退到「全部命中」里优先级
  // 最高、配置最新的一条——Windows 重排端点 GUID 后老记录挂在**新**设备 GUID 上，
  // 若只在选中设备里找，用户不切到那台设备就看不到迁移入口。
  const matches = useMemo(() => {
    const matched = items.filter((s) => !!s.target_guid);
    if (matched.length === 0) return [];
    const key = selectedGuid?.toLowerCase() ?? null;
    const forSelected = key
      ? matched.filter((s) => s.target_guid!.toLowerCase() === key)
      : [];
    const pool = forSelected.length > 0 ? forSelected : matched;
    return [...pool].sort((a, b) => {
      const partial = a.target_state === "matched_partial" ? 0 : 1;
      const partialB = b.target_state === "matched_partial" ? 0 : 1;
      if (partial !== partialB) return partial - partialB;
      return (b.config_mtime_ms ?? 0) - (a.config_mtime_ms ?? 0);
    });
  }, [items, selectedGuid]);

  if (matches.length === 0) return null;
  const primary = matches[0];
  const targetGuid = primary.target_guid ?? "";
  const targetName = primary.target_name ?? primary.display_name;
  const targetKey = targetGuid.toLowerCase();
  const isSelectedDevice =
    !!selectedGuid && selectedGuid.toLowerCase() === targetKey;
  // 清理只作用于同一目标设备的那组旧记录：回退候选集可能混入其它设备的记录。
  const sameTarget = matches.filter(
    (s) => (s.target_guid ?? "").toLowerCase() === targetKey,
  );
  const needsRepair = primary.target_state === "matched_partial";
  const configText = primary.config_path ?? "-";
  const snapshotText = primary.snapshot_path ?? "-";
  const message = t("stale.migrate.confirm", {
    name: targetName,
    config: configText,
    snapshot: snapshotText,
    mode: primary.inferred_mode,
  });

  const runMigrate = async () => {
    setConfirmOpen(false);
    const report = await onMigrate(primary.guid, targetGuid, null, null);
    if (report?.success) onDone(t("stale.migrate.done"));
  };

  const runCleanup = async () => {
    for (const item of sameTarget) {
      await onCleanup(item.guid);
    }
    onDone(t("stale.cleanup.done"));
  };

  return (
    <>
      <div className="stale-banner">
        <span className="stale-banner-icon">
          <TriangleAlert size={15} />
        </span>
        <span className="stale-banner-text">
          {needsRepair
            ? t("stale.banner.partial")
            : isSelectedDevice
              ? t("stale.banner.healthy")
              : t("stale.banner.other", { name: targetName })}
        </span>
        <button
          className="stale-banner-btn primary"
          type="button"
          disabled={busy}
          onClick={() => setConfirmOpen(true)}
        >
          {needsRepair ? t("stale.migrate") : t("stale.migrate.config")}
        </button>
        <button
          className="stale-banner-btn"
          type="button"
          disabled={busy}
          onClick={() => void runCleanup()}
        >
          {t("stale.cleanup")}
        </button>
      </div>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={t("stale.migrate.title")}
        message={message}
        confirmText={t("stale.migrate")}
        confirmVariant="primary"
        onConfirm={() => void runMigrate()}
      />
    </>
  );
}

export default memo(StaleInstallBanner);
