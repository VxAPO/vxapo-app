import type { PointerEvent as ReactPointerEvent } from "react";
import { GripVertical } from "lucide-react";
import type { Preset } from "../types";

interface PresetCardProps {
  index: number;
  preset: Preset;
  intensity: number;
  onChangeIntensity: (value: number) => void;
  dragging: boolean;
  selected?: boolean;
  onGripDown: (e: ReactPointerEvent<HTMLSpanElement>) => void;
}

export default function PresetCard({
  index,
  preset,
  intensity,
  onChangeIntensity,
  dragging,
  selected,
  onGripDown,
}: PresetCardProps) {
  return (
    <div className={`module-card ${dragging ? "dragging" : ""} ${selected ? "selected" : ""}`} data-index={index}>
      <span
        className="grip"
        title="拖动排序"
        onPointerDown={onGripDown}
      >
        <GripVertical size={16} />
      </span>
      <span className="seq">#{index + 1}</span>
      <span className="title">
        {preset.icon} {preset.name}
      </span>
      <span className="desc">{preset.description}</span>
      <span className="intensity">
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={intensity}
          onChange={(e) => onChangeIntensity(Number(e.target.value))}
        />
      </span>
      <span className="pct">{Math.round(intensity * 100)}%</span>
    </div>
  );
}
