import type { ReactNode } from "react";

export type MusesTheme = "light" | "dark" | "system";

export interface DesignSystemProviderProps {
  readonly children?: ReactNode;
  readonly theme?: MusesTheme;
  readonly className?: string;
}

export function DesignSystemProvider({
  children,
  className,
  theme = "system",
}: DesignSystemProviderProps) {
  const rootClassName =
    className === undefined ? "muses-root" : `muses-root ${className}`;

  return (
    <div className={rootClassName} data-theme={theme}>
      {children}
    </div>
  );
}
