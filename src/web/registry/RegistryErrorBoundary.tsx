import { Component, type ErrorInfo, type ReactNode } from "react";
import { SafeFallback } from "./SafeFallback";

export interface RegistryErrorBoundaryProps {
  readonly componentId: string;
  readonly requestedType: string;
  readonly children: ReactNode;
  readonly onError?: (error: Error, info: ErrorInfo) => void;
}

interface RegistryErrorBoundaryState {
  readonly failed: boolean;
}

export class RegistryErrorBoundary extends Component<
  RegistryErrorBoundaryProps,
  RegistryErrorBoundaryState
> {
  public override state: RegistryErrorBoundaryState = { failed: false };

  public static getDerivedStateFromError(): RegistryErrorBoundaryState {
    return { failed: true };
  }

  public override componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onError?.(error, info);
  }

  public override render(): ReactNode {
    if (this.state.failed) {
      return (
        <SafeFallback
          id={this.props.componentId}
          reason="component.render-error"
          requestedType={this.props.requestedType}
        />
      );
    }

    return this.props.children;
  }
}
