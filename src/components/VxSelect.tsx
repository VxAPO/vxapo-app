import * as Select from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";

export interface VxSelectOption {
  value: string;
  label: string;
}

interface VxSelectProps {
  value: string;
  options: VxSelectOption[];
  onValueChange: (value: string) => void;
  ariaLabel?: string;
}

export default function VxSelect({ value, options, onValueChange, ariaLabel }: VxSelectProps) {
  return (
    <Select.Root value={value} onValueChange={onValueChange}>
      <Select.Trigger className="vx-select" aria-label={ariaLabel}>
        <Select.Value />
        <Select.Icon className="vx-select-icon">
          <ChevronDown size={14} />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content className="vx-select-content" position="popper" sideOffset={4}>
          <Select.Viewport className="vx-select-viewport">
            {options.map((o) => (
              <Select.Item key={o.value} value={o.value} className="vx-select-item">
                <Select.ItemText>{o.label}</Select.ItemText>
                <Select.ItemIndicator className="vx-select-indicator">
                  <Check size={14} />
                </Select.ItemIndicator>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
