import { Fragment } from "react";
import { X } from "lucide-react";
import type { Device } from "../lib/model";

interface DeviceTabsProps {
  devices: Device[];
  selectedGuid: string | null;
  tuningOn: (guid: string) => boolean;
  onSelect: (guid: string) => void;
  onToggleTuning: (guid: string) => void;
  onUninstall: (device: Device) => void;
}

export default function DeviceTabs({
  devices,
  selectedGuid,
  tuningOn,
  onSelect,
  onToggleTuning,
  onUninstall,
}: DeviceTabsProps) {
  return (
    <div className="tab-bar">
      <div className="tab-group">
        {devices.map((d, i) => (
          <Fragment key={d.guid}>
            {i > 0 && <span className="tab-sep" />}
            <div className={`tab-item ${d.guid === selectedGuid ? "active" : ""}`}>
              <button
                className={`tab-dot ${tuningOn(d.guid) ? "on" : ""}`}
                type="button"
                aria-label={tuningOn(d.guid) ? "关闭该设备调音" : "开启该设备调音"}
                title={tuningOn(d.guid) ? "调音已开启，点击关闭" : "调音已关闭，点击开启"}
                onClick={() => onToggleTuning(d.guid)}
              />
              <button className="tab-btn" type="button" onClick={() => onSelect(d.guid)}>
                {d.name}
              </button>
              <button
                className="tab-close"
                type="button"
                aria-label={`卸载 ${d.name}`}
                onClick={() => onUninstall(d)}
              >
                <X size={13} strokeWidth={2.5} />
              </button>
            </div>
          </Fragment>
        ))}
      </div>
      <button className="tab-add" type="button" aria-label="新设备安装">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="2" strokeLinecap="butt" />
        </svg>
      </button>
    </div>
  );
}
