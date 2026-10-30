import type { CSSProperties, HTMLAttributes } from "react";

interface GapStyle extends CSSProperties {
  readonly "--muses-stack-gap"?: string;
  readonly "--muses-inline-gap"?: string;
}

export interface StackProps extends HTMLAttributes<HTMLDivElement> {
  readonly gap?: string;
}

export function Stack({ className, gap, style, ...rest }: StackProps) {
  const classes =
    className === undefined ? "muses-stack" : `muses-stack ${className}`;
  const mergedStyle: GapStyle =
    gap === undefined ? { ...style } : { ...style, "--muses-stack-gap": gap };
  return <div className={classes} style={mergedStyle} {...rest} />;
}

export function Inline({ className, gap, style, ...rest }: StackProps) {
  const classes =
    className === undefined ? "muses-inline" : `muses-inline ${className}`;
  const mergedStyle: GapStyle =
    gap === undefined ? { ...style } : { ...style, "--muses-inline-gap": gap };
  return <div className={classes} style={mergedStyle} {...rest} />;
}
