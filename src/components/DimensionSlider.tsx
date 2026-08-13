import type { Dimension } from "../types";

interface DimensionSliderProps {
  dimension: Dimension;
  value: number;
  onChange: (value: number) => void;
}

export default function DimensionSlider({ dimension, value, onChange }: DimensionSliderProps) {
  return (
    <div className="dimension-slider">
      <div className="dim-head">
        <span>{dimension.name}</span>
        <span>{Math.round(value * 100)}%</span>
      </div>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <div className="dim-labels">
        <span>{dimension.low_label}</span>
        <span>{dimension.high_label}</span>
      </div>
      <div style={{ fontSize: 11, color: "var(--text-tertiary)", marginTop: 4 }}>
        {dimension.description}
      </div>
    </div>
  );
}
