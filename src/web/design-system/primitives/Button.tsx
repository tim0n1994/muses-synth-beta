import type { ButtonHTMLAttributes } from "react";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: "secondary" | "primary" | "danger";
}

export function Button({
  className,
  type = "button",
  variant = "secondary",
  ...rest
}: ButtonProps) {
  const classes =
    className === undefined ? "muses-button" : `muses-button ${className}`;
  return (
    <button className={classes} data-variant={variant} type={type} {...rest} />
  );
}
