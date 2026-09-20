import { t } from "../lib/i18n/core";
import { useUiStore } from "../stores/uiStore";
import logoUrl from "../assets/VxAPO_icon_v4.svg";

/** 未安装任何设备时的空态：点加号即打开安装对话框。 */
export default function NoDeviceHint() {
  return (
    <div className="no-device">
      <img className="no-device-logo" src={logoUrl} alt="" draggable={false} />
      <button
        type="button"
        className="no-device-row"
        onClick={() => useUiStore.getState().setInstallOpen(true)}
      >
        <span className="no-device-plus">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="2" strokeLinecap="butt" />
          </svg>
        </span>
        <span className="no-device-tip">{t("no.device")}</span>
      </button>
    </div>
  );
}
