import type { HTMLAttributes } from "react";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  readonly tone?: "neutral" | "positive" | "warning" | "danger" | "accent";
}

export function Badge({ className, tone = "neutral", ...rest }: BadgeProps) {
  const classes =
    className === undefined ? "muses-badge" : `muses-badge ${className}`;
  return <span className={classes} data-tone={tone} {...rest} />;
}
