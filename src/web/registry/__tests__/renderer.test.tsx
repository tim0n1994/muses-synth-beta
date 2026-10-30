import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { DesignSystemProvider } from "../../design-system";
import { DashboardRenderer } from "../DashboardRenderer";
import type {
  DashboardConfigInput,
  RegistryAction,
  RegistryCapability,
} from "../types";

const audioCapabilities: readonly RegistryCapability[] = [
  "effect.audio:read",
  "effect.audio:write",
];

const audioConfig: DashboardConfigInput = {
  schemaVersion: "1.0",
  dashboardId: "audio-test",
  sections: [
    {
      id: "audio",
      type: "audio.control",
      schemaVersion: "1.0",
      layout: { columnSpan: { sm: 4, md: 4, lg: 4 } },
      props: {
        playing: false,
        trackTitle: "Test track",
        volume: 40,
        muted: false,
      },
    },
  ],
};

describe("DashboardRenderer", () => {
  it("renders only a safe fallback for structurally invalid configuration", () => {
    render(
      <DesignSystemProvider>
        <DashboardRenderer
          capabilities={[]}
          config={{ schemaVersion: "1.0" }}
        />
      </DesignSystemProvider>,
    );

    expect(
      screen.getByRole("heading", { name: "Unavailable component" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Test track")).not.toBeInTheDocument();
  });

  it("supports keyboard control and emits typed audio actions", async () => {
    const user = userEvent.setup();
    const actions: RegistryAction[] = [];

    render(
      <DesignSystemProvider>
        <DashboardRenderer
          capabilities={audioCapabilities}
          config={audioConfig}
          onAction={(action) => actions.push(action)}
        />
      </DesignSystemProvider>,
    );

    await user.tab();
    expect(screen.getByRole("switch", { name: "Audio paused" })).toHaveFocus();
    await user.keyboard(" ");
    expect(actions.at(-1)).toEqual({
      componentId: "audio",
      name: "audio.play",
    });

    await user.tab();
    expect(screen.getByRole("slider", { name: "Volume: 40%" })).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(actions.at(-1)).toMatchObject({
      componentId: "audio",
      name: "audio.volume",
    });

    await user.tab();
    expect(screen.getByRole("button", { name: "Mute" })).toHaveFocus();
  });

  it("does not render requested component props when capabilities are missing", () => {
    const onAction = vi.fn();

    render(
      <DesignSystemProvider>
        <DashboardRenderer
          capabilities={["effect.audio:read"]}
          config={audioConfig}
          onAction={onAction}
        />
      </DesignSystemProvider>,
    );

    expect(
      screen.getByText("Reason: component.missing-capability"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Test track")).not.toBeInTheDocument();
    expect(onAction).not.toHaveBeenCalled();
  });
});
