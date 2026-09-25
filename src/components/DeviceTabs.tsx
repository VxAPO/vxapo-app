import { memo } from "react";
import { X } from "lucide-react";
import type { Device } from "../lib/model";
import { t } from "../lib/i18n/core";

interface DeviceTabsProps {
  devices: Device[];
  selectedGuid: string | null;
  /** 逐设备总开关状态。传**数据**而不是 `(guid) => boolean` 取值函数：
      本组件是 memo 的，函数引用恒定就等于「开关变了也不重渲」，圆点不会跟随（曾经的 bug）。 */
  tuningMap: Record<string, boolean>;
  onSelect: (guid: string) => void;
  onToggleTuning: (guid: string) => void;
  onUninstall: (device: Device) => void;
  onAdd: () => void;
}

function DeviceTabs({
  devices,
  selectedGuid,
  tuningMap,
  onSelect,
  onToggleTuning,
  onUninstall,
  onAdd,
}: DeviceTabsProps) {
  return (
    <div className="tab-bar">
      <div className="tab-group">
        {devices.map((d) => {
          const on = tuningMap[d.guid] ?? true;
          return (
          <div className={`tab-item ${d.guid === selectedGuid ? "active" : ""}`} key={d.guid}>
            <button
              className={`tab-dot ${on ? "on" : ""}`}
              type="button"
              aria-label={on ? t("disable.device") : t("enable.device")}
              title={on ? t("disable.device") : t("enable.device")}
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
          );
        })}
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
