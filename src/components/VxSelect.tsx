import * as Select from "@radix-ui/react-select";
import { useEffect, useState, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";

export interface VxSelectOption {
  value: string;
  label: string;
}

interface VxSelectProps {
  value?: string;
  options: VxSelectOption[];
  onValueChange: (value: string) => void;
  ariaLabel?: string;
  disabled?: boolean;
  placeholder?: string;
  icon?: ReactNode;
}

export default function VxSelect({
  value,
  options,
  onValueChange,
  ariaLabel,
  disabled = false,
  placeholder,
  icon,
}: VxSelectProps) {
  // Radix Select 在 React 19 下有受控值被空字符串重置的已知问题：
  // 用本地状态承接点击结果，并忽略空字符串回调，保证选择稳定落盘
  const [internal, setInternal] = useState(value);
  useEffect(() => {
    setInternal(value);
  }, [value]);

  return (
    <Select.Root
      value={internal}
      onValueChange={(v) => {
        if (v === "") return;
        setInternal(v);
        onValueChange(v);
      }}
      disabled={disabled}
    >
      <Select.Trigger className={`vx-select${disabled ? " disabled" : ""}`} aria-label={ariaLabel}>
        {icon}
        <Select.Value placeholder={placeholder} />
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
