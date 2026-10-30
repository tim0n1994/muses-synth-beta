import * as SwitchPrimitive from "@radix-ui/react-switch";

export interface SwitchFieldProps {
  readonly checked: boolean;
  readonly disabled?: boolean;
  readonly label: string;
  readonly onCheckedChange: (checked: boolean) => void;
}

export function SwitchField({
  checked,
  disabled = false,
  label,
  onCheckedChange,
}: SwitchFieldProps) {
  return (
    <div className="muses-inline">
      <SwitchPrimitive.Root
        aria-label={label}
        checked={checked}
        className="muses-switch"
        disabled={disabled}
        onCheckedChange={onCheckedChange}
      >
        <SwitchPrimitive.Thumb className="muses-switch__thumb" />
      </SwitchPrimitive.Root>
      <span>{label}</span>
    </div>
  );
}
