import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AudioRuntime } from "../../audio/audio-runtime";
import { createQueryClient } from "../../foundation/query-client";
import { Dashboard } from "../Dashboard";
import { DashboardApiError } from "../api";
import type {
  DashboardApi,
  DashboardRegistry,
  DashboardRegistryBlock,
  DashboardSnapshot,
  LlmTextResult,
} from "../types";
import {
  firstEventPageFixture,
  llmSnapshotFixture,
  secondEventPageFixture,
  serverSnapshotFixture,
} from "./fixtures";

/**
 * Dashboard mounts `useLlmGeneration`, whose `useMutation` calls require a
 * QueryClient — in production `app-providers.tsx` supplies one around the
 * whole router. This is the entire test-side cost of the LLM layer (B3(d)).
 */
function renderWithProviders(ui: ReactNode): ReturnType<typeof render> {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      {ui}
    </QueryClientProvider>,
  );
}

const llmTextResult: LlmTextResult = {
  text: "Focused editor work.",
  model: "auto",
  generatedAt: "2026-10-19T10:05:00.000Z",
};

function createRegistry(
  renderedTypes: DashboardRegistryBlock["type"][],
): DashboardRegistry {
  return {
    render(block): ReactNode {
      renderedTypes.push(block.type);
      return createElement(
        "section",
        {
          "aria-label": `registry ${block.type}`,
          className: "muses-dashboard__panel",
        },
        block.type,
      );
    },
  };
}

/**
 * A runtime backed by a stub facade: jsdom has no AudioContext, and these
 * tests assert dashboard wiring, not the Web Audio graph (which has its own
 * unit tests in src/web/audio).
 */
function createAudioRuntime(): AudioRuntime {
  return new AudioRuntime({
    manualCooldownMs: 0,
    facade: {
      start: async () => undefined,
      applyProfile: async () => undefined,
      rampMasterGain: async () => undefined,
      pause: async () => undefined,
      dispose: async () => undefined,
    },
  });
}

function createApi(overrides: Partial<DashboardApi> = {}): DashboardApi {
  return {
    getSnapshot: vi.fn(async () => serverSnapshotFixture),
    getEvents: vi.fn(async () => firstEventPageFixture),
    postEffectOutcome: vi.fn(async () => ({
      accepted: true,
      snapshotId: "snapshot-002",
    })),
    postLlmNarration: vi.fn(async () => llmTextResult),
    postLlmSummary: vi.fn(async () => llmTextResult),
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Observatory Dashboard", () => {
  it("shows a semantic loading state before the local API resolves", () => {
    const api = createApi({
      getSnapshot: vi.fn(() => new Promise<DashboardSnapshot>(() => undefined)),
    });
    renderWithProviders(
      <Dashboard
        api={api}
        audioRuntime={createAudioRuntime()}
        registry={createRegistry([])}
        initialLiveRefresh={false}
      />,
    );
    expect(
      screen
        .getByLabelText("Loading Observatory dashboard")
        .getAttribute("aria-busy"),
    ).toBe("true");
    expect(screen.getByRole("main")).not.toBeNull();
    expect(
      screen.getByText("Skip to Observatory content").getAttribute("href"),
    ).toBe("#observatory-content");
  });

  it("composes all eight static registry block types from server responses", async () => {
    const renderedTypes: DashboardRegistryBlock["type"][] = [];
    renderWithProviders(
      <Dashboard
        api={createApi()}
        audioRuntime={createAudioRuntime()}
        registry={createRegistry(renderedTypes)}
        initialLiveRefresh={false}
      />,
    );

    await screen.findByLabelText("registry state.hero");
    await waitFor(() => {
      expect(new Set(renderedTypes)).toEqual(
        new Set([
          "state.hero",
          "belief.distribution",
          "evidence.list",
          "events.timeline",
          "decision.card",
          "audio.control",
          "metrics.grid",
          "privacy.status",
        ]),
      );
    });
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Context, belief, and reversible action",
      }),
    ).not.toBeNull();
    expect(screen.getByLabelText("Local-only runtime")).not.toBeNull();
  });

  it("distinguishes disconnected from server-error and never inserts demo state", async () => {
    const disconnectedApi = createApi({
      getSnapshot: vi.fn(async () => {
        throw new DashboardApiError({
          kind: "network",
          message: "Connection refused",
          retryable: true,
        });
      }),
    });
    const client = createQueryClient();
    const wrap = (element: ReactNode): ReactNode => (
      <QueryClientProvider client={client}>{element}</QueryClientProvider>
    );
    const { rerender } = render(
      wrap(
        <Dashboard
          api={disconnectedApi}
          audioRuntime={createAudioRuntime()}
          registry={createRegistry([])}
          initialLiveRefresh={false}
        />,
      ),
    );
    expect(
      await screen.findByRole("heading", { name: "Local server disconnected" }),
    ).not.toBeNull();
    expect(screen.queryByLabelText("registry state.hero")).toBeNull();

    const serverErrorApi = createApi({
      getSnapshot: vi.fn(async () => {
        throw new DashboardApiError({
          kind: "http",
          message: "HTTP 500",
          statusCode: 500,
          retryable: true,
        });
      }),
    });
    rerender(
      wrap(
        <Dashboard
          api={serverErrorApi}
          audioRuntime={createAudioRuntime()}
          registry={createRegistry([])}
          initialLiveRefresh={false}
        />,
      ),
    );
    expect(
      await screen.findByRole("heading", {
        name: "Observatory could not load",
      }),
    ).not.toBeNull();
  });

  it("shows stale data with an explicit retry banner", async () => {
    const staleSnapshot = {
      ...serverSnapshotFixture,
      freshness: "stale" as const,
    };
    renderWithProviders(
      <Dashboard
        api={createApi({ getSnapshot: vi.fn(async () => staleSnapshot) })}
        audioRuntime={createAudioRuntime()}
        registry={createRegistry([])}
        initialLiveRefresh={false}
      />,
    );
    expect(
      await screen.findByText("Showing the last server snapshot."),
    ).not.toBeNull();
    expect(screen.getByLabelText("registry state.hero")).not.toBeNull();
  });

  it("loads older events using the returned cursor and disables the control while loading", async () => {
    let resolveSecondPage:
      ((value: typeof secondEventPageFixture) => void) | null = null;
    const getEvents = vi.fn((cursor: string | null) => {
      if (cursor === null) {
        return Promise.resolve(firstEventPageFixture);
      }
      return new Promise<typeof secondEventPageFixture>((resolve) => {
        resolveSecondPage = resolve;
      });
    });
    const api = createApi({ getEvents });
    renderWithProviders(
      <Dashboard
        api={api}
        audioRuntime={createAudioRuntime()}
        registry={createRegistry([])}
        initialLiveRefresh={false}
      />,
    );

    const loadMore = await screen.findByRole("button", {
      name: "Load older events",
    });
    // Wait for the initial page to load so nextCursor ('cursor-2') is set before clicking load-more
    await waitFor(() => {
      expect(getEvents).toHaveBeenCalledTimes(1);
    });
    fireEvent.click(loadMore);
    expect(
      screen.getByRole("button", {
        name: "Loading older events…",
      }),
    ).toBeDisabled();
    await waitFor(() => {
      expect(getEvents).toHaveBeenLastCalledWith(
        "cursor-2",
        24,
        expect.any(AbortSignal),
      );
    });

    await act(async () => {
      resolveSecondPage?.(secondEventPageFixture);
    });
    expect(
      await screen.findByRole("button", {
        name: "All available events loaded",
      }),
    ).toBeDisabled();
  });

  it("supports keyboard-operable live refresh controls", async () => {
    vi.useFakeTimers();
    const api = createApi();
    renderWithProviders(
      <Dashboard
        api={api}
        audioRuntime={createAudioRuntime()}
        registry={createRegistry([])}
        initialLiveRefresh
        initialRefreshIntervalMs={5_000}
      />,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByLabelText("registry state.hero")).not.toBeNull();

    const toolbar = screen.getByRole("region", {
      name: "Dashboard refresh controls",
    });
    const liveRefresh = within(toolbar).getByRole("checkbox", {
      name: "Live refresh",
    });
    const interval = within(toolbar).getByRole("combobox", {
      name: "Interval",
    });
    expect((liveRefresh as HTMLInputElement).checked).toBe(true);
    expect((interval as HTMLSelectElement).disabled).toBe(false);

    fireEvent.click(liveRefresh);
    expect((liveRefresh as HTMLInputElement).checked).toBe(false);
    expect((interval as HTMLSelectElement).disabled).toBe(true);

    fireEvent.click(liveRefresh);
    await act(async () => {
      vi.advanceTimersByTime(5_000);
      await Promise.resolve();
    });
    expect(api.getSnapshot).toHaveBeenCalledTimes(2);
  });

  it("hands the mounted LLM generation state to registry blocks", async () => {
    const seenLlmContexts: unknown[] = [];
    const registry: DashboardRegistry = {
      render(block, context): ReactNode {
        seenLlmContexts.push(context.llm);
        return createElement(
          "section",
          { "aria-label": `registry ${block.type}` },
          block.type,
        );
      },
    };
    renderWithProviders(
      <Dashboard
        api={createApi({
          getSnapshot: vi.fn(async () => llmSnapshotFixture),
          getEvents: vi.fn(async () => firstEventPageFixture),
        })}
        audioRuntime={createAudioRuntime()}
        registry={registry}
        initialLiveRefresh={false}
      />,
    );

    await screen.findByLabelText("registry llm.narration");
    expect(seenLlmContexts.length).toBeGreaterThan(0);
    for (const llm of seenLlmContexts) {
      expect(llm).toBeDefined();
      expect(llm).toMatchObject({
        narration: { status: "idle" },
        summary: { status: "idle" },
      });
    }
  });
});
