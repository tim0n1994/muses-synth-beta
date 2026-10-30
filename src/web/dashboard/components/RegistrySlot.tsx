import { Component, type ReactNode } from "react";

import { useI18n } from "../../i18n";
import type {
  DashboardRegistry,
  DashboardRegistryBlock,
  DashboardRegistryContext,
} from "../types";

interface RegistrySlotProps {
  readonly registry: DashboardRegistry;
  readonly block: DashboardRegistryBlock;
  readonly context: DashboardRegistryContext;
  readonly title: string;
  readonly className?: string | undefined;
}

interface RegistryBoundaryProps {
  readonly resetKey: string;
  readonly title: string;
  readonly children: ReactNode;
}

interface RegistryBoundaryState {
  readonly failed: boolean;
}

class RegistryBoundary extends Component<
  RegistryBoundaryProps,
  RegistryBoundaryState
> {
  public override state: RegistryBoundaryState = { failed: false };

  public static getDerivedStateFromError(): RegistryBoundaryState {
    return { failed: true };
  }

  public override componentDidUpdate(
    previousProps: RegistryBoundaryProps,
  ): void {
    if (previousProps.resetKey !== this.props.resetKey && this.state.failed) {
      this.setState({ failed: false });
    }
  }

  public override render(): ReactNode {
    if (this.state.failed) {
      return <RegistryDegraded title={this.props.title} />;
    }
    return this.props.children;
  }
}

function RegistryDegraded({ title }: { title: string }): ReactNode {
  const { t } = useI18n();
  return (
    <section
      className="muses-dashboard__panel muses-dashboard__panel--degraded"
      aria-labelledby="registry-degraded-title"
    >
      <p className="muses-dashboard__eyebrow">
        {t("dashboard.slot.degradedEyebrow")}
      </p>
      <h2 id="registry-degraded-title">{title}</h2>
      <p>{t("dashboard.slot.degradedBody")}</p>
    </section>
  );
}

export function RegistrySlot(props: RegistrySlotProps): ReactNode {
  const resetKey = `${props.block.type}:${JSON.stringify(props.block.data)}`;
  const className = ["muses-dashboard__slot", props.className]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={className} data-block-type={props.block.type}>
      <RegistryBoundary resetKey={resetKey} title={props.title}>
        {props.registry.render(props.block, props.context)}
      </RegistryBoundary>
    </div>
  );
}
