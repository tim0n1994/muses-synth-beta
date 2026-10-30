import { Component, type ErrorInfo, type ReactNode } from "react";

import { createTranslator } from "../i18n";

export interface RootErrorBoundaryProps {
  readonly children: ReactNode;
  readonly onError?: (error: Error, info: ErrorInfo) => void;
  readonly resetKey?: string;
}

interface RootErrorBoundaryState {
  readonly failed: boolean;
}

/**
 * Rendered when the tree is already broken, so it must not depend on any
 * provider being alive: it always renders in English (the i18n default).
 */
const t = createTranslator("en");

export class RootErrorBoundary extends Component<
  RootErrorBoundaryProps,
  RootErrorBoundaryState
> {
  override state: RootErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): RootErrorBoundaryState {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.(error, info);
  }

  override componentDidUpdate(previousProps: RootErrorBoundaryProps): void {
    if (this.state.failed && previousProps.resetKey !== this.props.resetKey) {
      this.setState({ failed: false });
    }
  }

  private readonly reset = (): void => {
    this.setState({ failed: false });
  };

  override render(): ReactNode {
    if (!this.state.failed) {
      return this.props.children;
    }

    return (
      <main className="fatal-boundary" role="alert">
        <p className="eyebrow">{t("foundation.errorBoundary.eyebrow")}</p>
        <h1>{t("foundation.errorBoundary.title")}</h1>
        <p>{t("foundation.errorBoundary.body")}</p>
        <button className="button" onClick={this.reset} type="button">
          {t("foundation.errorBoundary.retry")}
        </button>
      </main>
    );
  }
}
