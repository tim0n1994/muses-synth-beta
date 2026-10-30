// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DesignSystemProvider } from "../../design-system";
import { LlmNarration } from "../components/LlmNarration";
import type {
  RegistryAction,
  RegistryLlmGeneration,
  RegistryRuntimeContext,
} from "../types";

const idle: RegistryLlmGeneration = {
  status: "idle",
  text: null,
  model: null,
  error: null,
  generatedAt: null,
};

const loading: RegistryLlmGeneration = {
  status: "loading",
  text: null,
  model: null,
  error: null,
  generatedAt: null,
};

function generation(
  overrides: Partial<RegistryLlmGeneration>,
): RegistryLlmGeneration {
  return { ...idle, ...overrides };
}

function renderPanel(
  props: { available: boolean; model: string; reason: string },
  runtime: Partial<RegistryRuntimeContext> = {},
): { actions: RegistryAction[] } {
  const actions: RegistryAction[] = [];
  const context: RegistryRuntimeContext = {
    capabilities: new Set(["llm:read"]),
    onAction: (action) => actions.push(action),
    llm: { narration: idle, summary: idle },
    ...runtime,
  };
  render(
    <DesignSystemProvider>
      <LlmNarration id="llm" props={props} runtime={context} />
    </DesignSystemProvider>,
  );
  return { actions };
}

const availableProps = { available: true, model: "auto", reason: "ready" };

describe("LlmNarration", () => {
  it("renders nothing without capability data or without the generation runtime", () => {
    // Double insurance next to the surface layer, which already hides the
    // widget for persistent unavailability.
    const { container } = render(
      <DesignSystemProvider>
        <LlmNarration
          id="llm"
          props={{ ...availableProps, available: false }}
          runtime={{
            capabilities: new Set(["llm:read"]),
            llm: { narration: idle, summary: idle },
          }}
        />
        <LlmNarration
          id="llm2"
          props={availableProps}
          runtime={{ capabilities: new Set() }}
        />
      </DesignSystemProvider>,
    );
    // The provider contributes its .muses-root shell regardless; the widget
    // itself must contribute nothing inside it.
    expect(container.querySelector(".muses-root")).toBeEmptyDOMElement();
  });

  it("shows the disclosure and dispatches both actions from idle", () => {
    const { actions } = renderPanel(availableProps);

    expect(
      screen.getByText(/sends the current belief summary and event counts/),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("llm-narration-generate"));
    fireEvent.click(screen.getByTestId("llm-narration-summarize"));

    expect(actions).toEqual([
      { componentId: "llm", name: "llm.narrate" },
      {
        componentId: "llm",
        name: "llm.summarize",
        payload: { windowMinutes: 60 },
      },
    ]);
  });

  it("disables both buttons and marks the region busy while generating", () => {
    renderPanel(availableProps, {
      llm: { narration: loading, summary: idle },
    });

    const panel = screen.getByTestId("llm-narration-panel");
    expect(panel.getAttribute("aria-busy")).toBe("true");
    expect(screen.getByText("Generating…")).toBeInTheDocument();
    expect(screen.getByTestId("llm-narration-generate")).toBeDisabled();
    expect(screen.getByTestId("llm-narration-summarize")).toBeDisabled();
  });

  it("keeps the panel during a cooldown with buttons disabled", () => {
    renderPanel({ ...availableProps, reason: "cooldown" });

    expect(
      screen.getByText("Temporarily unavailable — retry shortly."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("llm-narration-generate")).toBeDisabled();
    expect(screen.getByTestId("llm-narration-summarize")).toBeDisabled();
  });

  it("shows the stored error with a retry that re-sends the same kind", () => {
    const { actions } = renderPanel(availableProps, {
      llm: {
        narration: idle,
        summary: generation({
          status: "error",
          error: "LLM_COOLDOWN: The narration gateway is cooling down.",
        }),
      },
    });

    expect(screen.getByTestId("llm-narration-error")).toHaveTextContent(
      "LLM_COOLDOWN",
    );
    fireEvent.click(screen.getByTestId("llm-narration-retry"));
    expect(actions.at(-1)).toEqual({
      componentId: "llm",
      name: "llm.summarize",
      payload: { windowMinutes: 60 },
    });
  });

  it("renders model output as plain text only, truncated, with no HTML surface", () => {
    const hostile = `<img src=x onerror="alert(1)"><script>steal()</script>${"a".repeat(5_000)}`;
    renderPanel(availableProps, {
      llm: {
        narration: generation({
          status: "done",
          text: hostile,
          model: "auto",
          generatedAt: "2026-10-19T10:05:00.000Z",
        }),
        summary: idle,
      },
    });

    const text = screen.getByTestId("llm-narration-text");
    // Plain React text node: markup stays literal text, never elements —
    // and the panel re-truncates at 4,000 characters on its own.
    expect(text.textContent).toHaveLength(4_000);
    expect(text.textContent?.startsWith("<img src=x")).toBe(true);
    expect(text.querySelector("img")).toBeNull();
    expect(text.querySelector("script")).toBeNull();
    expect(screen.getByTestId("llm-narration-model").textContent).toContain(
      "Generated by auto",
    );
  });

  it("suppresses the generated-by line when the widget opted out of showModel", () => {
    renderPanel(
      { ...availableProps, model: "hidden" },
      {
        llm: {
          narration: generation({
            status: "done",
            text: "A calm summary.",
            model: "auto",
            generatedAt: "2026-10-19T10:05:00.000Z",
          }),
          summary: idle,
        },
      },
    );

    expect(screen.getByTestId("llm-narration-text")).toBeInTheDocument();
    expect(screen.queryByTestId("llm-narration-model")).not.toBeInTheDocument();
  });

  it("shows the summary result while narration has not run", () => {
    renderPanel(availableProps, {
      llm: {
        narration: idle,
        summary: generation({
          status: "done",
          text: "An hour of steady work.",
          model: "auto",
          generatedAt: "2026-10-19T10:05:00.000Z",
        }),
      },
    });

    expect(screen.getByText("An hour of steady work.")).toBeInTheDocument();
  });
});
