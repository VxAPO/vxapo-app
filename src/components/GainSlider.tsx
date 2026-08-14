import * as Slider from "@radix-ui/react-slider";

interface GainSliderProps {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  onValueChange: (value: number) => void;
  ariaLabel?: string;
}

export default function GainSlider({
  value,
  min = -12,
  max = 12,
  step = 0.1,
  disabled = false,
  onValueChange,
  ariaLabel = "Gain",
}: GainSliderProps) {
  return (
    <Slider.Root
      className={`gs-root${disabled ? " disabled" : ""}`}
      disabled={disabled}
      min={min}
      max={max}
      step={step}
      value={[value]}
      onValueChange={(v) => onValueChange(v[0] ?? 0)}
      aria-label={ariaLabel}
    >
      <Slider.Track className="gs-track">
        <Slider.Range className="gs-range" />
      </Slider.Track>
      <Slider.Thumb className="gs-thumb" />
    </Slider.Root>
  );
}
