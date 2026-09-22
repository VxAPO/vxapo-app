import { useEffect, useState, type RefObject } from "react";
import { usePresence } from "framer-motion";
import { ChevronDown, Copy, Save, Trash2 } from "lucide-react";
import { channelLabel } from "../lib/channels";
import { t } from "../lib/i18n/core";
import { useGlassRing } from "../hooks/useGlassRing";
import { useEdgeTintLayer } from "../hooks/useEdgeTintLayer";

/** 玻璃淡入淡出时长：与 .fx-toolbar 的 --glass-t 过渡时长一致（退出卸载也等这么久）。 */
export const TOOLBAR_FADE_MS = 180;

interface SelectionToolbarProps {
  selectedCount: number;
  channelOn: boolean;
  channelNames: string[];
  activeChannel: string;
  copyOpen: boolean;
  toolbarRef: RefObject<HTMLDivElement | null>;
  onToggleCopy: () => void;
  onCopyToChannel: (ch: string) => void;
  onSave: () => void;
  onDelete: () => void;
}

/** 框选后的浮动工具栏：复制到声道 / 保存为自定义预设 / 删除 */
export default function SelectionToolbar({
  selectedCount,
  channelOn,
  channelNames,
  activeChannel,
  copyOpen,
  toolbarRef,
  onToggleCopy,
  onCopyToChannel,
  onSave,
  onDelete,
}: SelectionToolbarProps) {
  useGlassRing(toolbarRef);
  useEdgeTintLayer(toolbarRef);

  // 淡入淡出改由 CSS 变量 --glass-t 承担（见 drag.css）：玻璃面板的 backdrop-filter
  // 在祖先 opacity<1 时会被浏览器整组降级——原来的 opacity 写法会让高斯模糊等淡入结束
  // 才「啪」地出现；变量写法下模糊半径、底衬与内容同一条时间轴渐变，染色 canvas 也能读
  // 同一个值同步淡出（canvas 是独立图层，不随 DOM 透明度变化）。
  const [isPresent, safeToRemove] = usePresence();
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!isPresent) {
      setShown(false);
      return;
    }
    const raf = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(raf);
  }, [isPresent]);
  // 退出：等玻璃淡完再让 AnimatePresence 卸载，否则 canvas 会在 DOM 消失的那一刻硬消失。
  useEffect(() => {
    if (isPresent) return;
    const id = window.setTimeout(() => safeToRemove?.(), TOOLBAR_FADE_MS);
    return () => window.clearTimeout(id);
  }, [isPresent, safeToRemove]);

  return (
    // 位置（transform）由 useMarqueeSelection 的跟随循环独占；居中与入场 6px 抬升
    // 交给 CSS 的 translate/动画，这里不再用 motion，避免两个所有者写同一属性。
    <div
      className={`fx fx-toolbar${shown ? " is-in" : ""}`}
      ref={toolbarRef}
    >
      <div className="sel-toolbar">
        <div className="sel-toolbar-label">{t("selected.count", { count: selectedCount })}</div>
        <div className="sel-toolbar-actions">
          {channelOn && (
            <div className="sel-copy">
              <button
                type="button"
                className="sel-copy-btn"
                onClick={onToggleCopy}
              >
                <Copy size={14} strokeWidth={2.2} />
                <span>{t("copy.toChannel")}</span>
                <ChevronDown size={14} />
              </button>
              {copyOpen && (
                <div className="sel-copy-menu">
                  {channelNames
                    .filter((c) => c !== activeChannel)
                    .map((c) => (
                      <button
                        key={c}
                        type="button"
                        className="sel-copy-item"
                        onClick={() => onCopyToChannel(c)}
                      >
                        {channelLabel(c)}
                      </button>
                    ))}
                </div>
              )}
            </div>
          )}
          <button className="sel-action save" type="button" onClick={onSave}>
            <Save size={14} strokeWidth={2.2} />
            <span>{t("save.preset")}</span>
          </button>
          <button className="sel-action delete" type="button" onClick={onDelete}>
            <Trash2 size={14} strokeWidth={2.2} />
            <span>{t("delete.selected")}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
