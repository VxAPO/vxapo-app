import * as Switch from "@radix-ui/react-switch";

interface VxSwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label?: string;
}

export default function VxSwitch({ checked, onCheckedChange, label }: VxSwitchProps) {
  return (
    <label className="vx-switch-row">
      {label && <span className="vx-switch-label">{label}</span>}
      <Switch.Root className="vx-switch" checked={checked} onCheckedChange={onCheckedChange}>
        <Switch.Thumb className="vx-switch-thumb" />
      </Switch.Root>
    </label>
  );
}
