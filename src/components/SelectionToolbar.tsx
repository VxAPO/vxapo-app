import type { RefObject } from "react";
import { motion } from "framer-motion";
import { ChevronDown, Copy, Save, Trash2 } from "lucide-react";
import { channelLabel } from "../lib/channels";
import { t } from "../lib/i18n";

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
  return (
    <motion.div
      className="sel-toolbar"
      ref={toolbarRef}
      initial={{ opacity: 0, x: "-50%", scale: 0.92, y: 6 }}
      animate={{ opacity: 1, x: "-50%", scale: 1, y: 0 }}
      exit={{ opacity: 0, x: "-50%", scale: 0.92, y: 6 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
    >
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
    </motion.div>
  );
}
