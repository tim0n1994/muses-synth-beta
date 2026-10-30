import * as ProgressPrimitive from "@radix-ui/react-progress";
import type { CSSProperties } from "react";

interface ProgressStyle extends CSSProperties {
  readonly "--muses-progress-value": string;
}

export interface ProgressProps {
  readonly value: number;
  readonly label: string;
  readonly max?: number;
}

export function Progress({ label, max = 100, value }: ProgressProps) {
  const safeMax = max > 0 ? max : 100;
  const boundedValue = Math.min(Math.max(value, 0), safeMax);
  const percentage = (boundedValue / safeMax) * 100;
  const style: ProgressStyle = { "--muses-progress-value": `${percentage}%` };

  return (
    <ProgressPrimitive.Root
      aria-label={label}
      className="muses-progress"
      max={safeMax}
      value={boundedValue}
    >
      <ProgressPrimitive.Indicator
        className="muses-progress__indicator"
        style={style}
      />
    </ProgressPrimitive.Root>
  );
}
