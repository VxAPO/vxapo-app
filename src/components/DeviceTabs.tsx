import { memo } from "react";
import { X } from "lucide-react";
import type { Device } from "../lib/model";
import { t } from "../lib/i18n";

interface DeviceTabsProps {
  devices: Device[];
  selectedGuid: string | null;
  tuningOn: (guid: string) => boolean;
  onSelect: (guid: string) => void;
  onToggleTuning: (guid: string) => void;
  onUninstall: (device: Device) => void;
  onAdd: () => void;
}

function DeviceTabs({
  devices,
  selectedGuid,
  tuningOn,
  onSelect,
  onToggleTuning,
  onUninstall,
  onAdd,
}: DeviceTabsProps) {
  return (
    <div className="tab-bar">
      <div className="tab-group">
        {devices.map((d) => (
          <div className={`tab-item ${d.guid === selectedGuid ? "active" : ""}`} key={d.guid}>
            <button
              className={`tab-dot ${tuningOn(d.guid) ? "on" : ""}`}
              type="button"
              aria-label={tuningOn(d.guid) ? t("disable.filter") : t("enable.filter")}
              title={tuningOn(d.guid) ? t("disable.filter") : t("enable.filter")}
              onClick={() => onToggleTuning(d.guid)}
            />
            <button className="tab-btn" type="button" onClick={() => onSelect(d.guid)}>
              <span className="tab-name">{d.name}</span>
            </button>
            <button
              className="tab-close"
              type="button"
              aria-label={`${t("uninstall")} ${d.name}`}
              onClick={() => onUninstall(d)}
            >
              <X size={14} strokeWidth={2.5} />
            </button>
          </div>
        ))}
      </div>
      {devices.length > 0 && (
        <button
          className="tab-add"
          type="button"
          aria-label={t("install.title")}
          title={t("install.title")}
          onClick={onAdd}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="2" strokeLinecap="butt" />
          </svg>
        </button>
      )}
    </div>
  );
}

export default memo(DeviceTabs);
