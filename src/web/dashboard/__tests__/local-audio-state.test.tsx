import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { AudioRuntime } from "../../audio/audio-runtime.js";
import { createQueryClient } from "../../foundation/query-client.js";
import { getRegistryDescriptor } from "../../registry/registry.js";
import { Dashboard } from "../Dashboard.js";
import { toRegistryProps } from "../registry-props.js";
import { dispatchRegistryAction } from "../registry-actions.js";
import type {
  DashboardApi,
  DashboardRegistry,
  DashboardSnapshot,
} from "../types.js";
import { firstEventPageFixture, serverSnapshotFixture } from "./fixtures.js";

afterEach(cleanup);

function runtime() {
  return new AudioRuntime({
    manualCooldownMs: 0,
    facade: {
      start: async () => {},
      applyProfile: async () => {},
      rampMasterGain: async () => {},
      pause: async () => {},
      dispose: async () => {},
    },
  });
}
const registry: DashboardRegistry = {
  render(block, context) {
    if (block.type !== "audio.control") return null;
    const Component = getRegistryDescriptor(block.type).render;
    return (
      <Component
        id="local-audio"
        props={toRegistryProps(block)}
        runtime={{
          capabilities: new Set(["effect.audio:read", "effect.audio:write"]),
          onAction: (action) => dispatchRegistryAction(action, context.actions),
        }}
      />
    );
  },
};
function fixture() {
  let snapshot: DashboardSnapshot = {
    ...serverSnapshotFixture,
    audio: { ...serverSnapshotFixture.audio, canPlay: true },
  };
  const api = {
    getSnapshot: vi.fn(async () => snapshot),
    getEvents: vi.fn(async () => firstEventPageFixture),
    postEffectOutcome: vi.fn(async () => ({ accepted: true })),
  } as unknown as DashboardApi;
  return {
    api,
    setStatus: (status: "playing" | "paused") => {
      snapshot = {
        ...snapshot,
        snapshotId: `${snapshot.snapshotId}-refresh`,
        audio: { ...snapshot.audio!, status },
      };
    },
  };
}
function mount(api: DashboardApi, audio: AudioRuntime) {
  const client = createQueryClient();
  const ui = (active: AudioRuntime) => (
    <QueryClientProvider client={client}>
      <Dashboard
        api={api}
        audioRuntime={active}
        registry={registry}
        initialLiveRefresh={false}
      />
    </QueryClientProvider>
  );
  return { ...render(ui(audio)), ui };
}

it("starts unchecked despite an old playing receipt, and updates before receipt acknowledgement", async () => {
  const f = fixture();
  let acknowledge!: () => void;
  vi.spyOn(f.api, "postEffectOutcome").mockImplementation(
    () =>
      new Promise((resolve) => {
        acknowledge = () =>
          resolve({ accepted: true, snapshotId: "acknowledged" });
      }),
  );
  const view = mount(f.api, runtime());
  const transport = await screen.findByRole("switch");
  expect(transport).not.toBeChecked();
  fireEvent.click(transport);
  await waitFor(() => expect(transport).toBeChecked());
  await waitFor(() => expect(f.api.postEffectOutcome).toHaveBeenCalledTimes(1));
  f.setStatus("paused"); // Another tab or a late poll reports its own pause.
  fireEvent.click(screen.getByRole("button", { name: "Refresh now" }));
  await waitFor(() => expect(f.api.getSnapshot).toHaveBeenCalledTimes(2));
  expect(transport).toBeChecked();
  await act(async () => {
    acknowledge();
  });
  view.unmount();
});

it("a new runtime is immediately unchecked after rerender; old-runtime updates cannot revive it", async () => {
  const f = fixture();
  const old = runtime();
  await old.runManualCommand("play", { effectId: "old" });
  const view = mount(f.api, old);
  await waitFor(() => expect(screen.getByRole("switch")).toBeChecked());
  const fresh = runtime();
  view.rerender(view.ui(fresh));
  expect(screen.getByRole("switch")).not.toBeChecked();
  await act(async () => {
    await old.runManualCommand("play", { effectId: "late-old" });
  });
  expect(screen.getByRole("switch")).not.toBeChecked();
  fireEvent.click(screen.getByRole("switch"));
  await waitFor(() => expect(screen.getByRole("switch")).toBeChecked());
  expect(fresh.snapshot().started).toBe(true);
});

it("a paused runtime stays unchecked through a new playing server snapshot", async () => {
  const f = fixture();
  const audio = runtime();
  await audio.runManualCommand("play", { effectId: "local" });
  mount(f.api, audio);
  await waitFor(() => expect(screen.getByRole("switch")).toBeChecked());
  await act(async () => {
    await audio.runManualCommand("pause", { effectId: "local" });
  });
  expect(screen.getByRole("switch")).not.toBeChecked();
  f.setStatus("playing");
  fireEvent.click(screen.getByRole("button", { name: "Refresh now" }));
  await waitFor(() => expect(f.api.getSnapshot).toHaveBeenCalledTimes(2));
  expect(screen.getByRole("switch")).not.toBeChecked();
});

it("keeps published server permissions on the local transport", async () => {
  const f = fixture();
  vi.mocked(f.api.getSnapshot).mockResolvedValue({
    ...serverSnapshotFixture,
    audio: {
      ...serverSnapshotFixture.audio,
      status: "playing",
      canPlay: false,
    },
  });
  const audio = runtime();
  mount(f.api, audio);
  const transport = await screen.findByRole("switch");
  expect(transport).not.toBeChecked();
  expect(transport).toBeDisabled();
  fireEvent.click(transport);
  expect(audio.snapshot().started).toBe(false);
  expect(f.api.postEffectOutcome).not.toHaveBeenCalled();
});
