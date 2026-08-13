import { Trash2 } from "lucide-react";
import type { Filter } from "../types";
import { fmtFreq } from "../data/presets";

interface FilterRowProps {
  filter: Filter;
  index: number;
  readOnly?: boolean;
  onChange?: (index: number, filter: Filter) => void;
  onDelete?: (index: number) => void;
}

export default function FilterRow({ filter, index, readOnly = false, onChange, onDelete }: FilterRowProps) {
  return (
    <div className="module-card" style={{ minHeight: 44 }}>
      <span className="seq">#{index + 1}</span>
      <span className="title" style={{ minWidth: 90 }}>
        {filter.type}
      </span>
      <span className="desc">{filter.label}</span>
      <span className="mono" style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-secondary)" }}>
        {fmtFreq(filter.frequency)} · {filter.gain.toFixed(1)} dB · Q {filter.q.toFixed(2)}
      </span>
      {!readOnly && onChange && (
        <button
          className="icon-btn"
          aria-label="删除"
          onClick={() => onDelete?.(index)}
        >
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );
}
