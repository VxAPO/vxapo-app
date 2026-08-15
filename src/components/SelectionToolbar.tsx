import type { RefObject } from "react";
import { ChevronDown, Copy, Save, Trash2 } from "lucide-react";
import { channelLabel } from "../lib/channels";

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
    <div className="sel-toolbar" ref={toolbarRef}>
      <div className="sel-toolbar-label">已选 {selectedCount} 段</div>
      <div className="sel-toolbar-actions">
        {channelOn && (
          <div className="sel-copy">
            <button
              type="button"
              className="sel-copy-btn"
              onClick={onToggleCopy}
            >
              <Copy size={14} strokeWidth={2.2} />
              <span>复制到声道</span>
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
          <span>保存为自定义预设</span>
        </button>
        <button className="sel-action delete" type="button" onClick={onDelete}>
          <Trash2 size={14} strokeWidth={2.2} />
          <span>删除</span>
        </button>
      </div>
    </div>
  );
}
