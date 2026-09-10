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
  const matches = useMemo(() => {
    if (!selectedGuid) return [];
    const key = selectedGuid.toLowerCase();
    return items
      .filter((s) => !!s.target_guid && s.target_guid.toLowerCase() === key)
      .sort((a, b) => {
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
    for (const item of matches) {
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
          {needsRepair ? t("stale.banner.partial") : t("stale.banner.healthy")}
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
