import type { HTMLAttributes, ReactNode } from "react";

export interface CardProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  readonly title?: ReactNode;
  readonly description?: ReactNode;
  readonly trailing?: ReactNode;
  readonly headingId?: string;
  readonly elevation?: "flat" | "raised";
}

export function Card({
  children,
  className,
  description,
  elevation = "flat",
  headingId,
  title,
  trailing,
  ...rest
}: CardProps) {
  const classes =
    className === undefined ? "muses-card" : `muses-card ${className}`;

  return (
    <section
      className={classes}
      data-elevation={elevation}
      aria-labelledby={headingId}
      {...rest}
    >
      {(title !== undefined || trailing !== undefined) && (
        <header className="muses-card__header">
          <div>
            {title !== undefined && (
              <h2 className="muses-card__title" id={headingId}>
                {title}
              </h2>
            )}
            {description !== undefined && (
              <div className="muses-card__description">{description}</div>
            )}
          </div>
          {trailing}
        </header>
      )}
      {children}
    </section>
  );
}
