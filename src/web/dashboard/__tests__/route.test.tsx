import { StrictMode, type ReactNode } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AudioRuntime } from "../../audio/audio-runtime.js";
import { WebAudioFacade } from "../../audio/web-audio-facade.js";
import { DashboardRoute } from "../route.js";

const observed = vi.hoisted(() => ({ runtimes: [] as AudioRuntime[] }));
vi.mock("../../auth/index.js", () => ({
  AuthChrome: ({ children }: { children: ReactNode }) => children,
  resolveBrowserLanguage: () => "en",
}));
vi.mock("../index.js", async () => {
  const { createElement, useState } = await import("react");
  return {
    createDashboardApiClient: () => ({}),
    Dashboard: ({ audioRuntime }: { audioRuntime: AudioRuntime }) => {
      observed.runtimes.push(audioRuntime);
      const [status, setStatus] = useState("idle");
      return createElement(
        "button",
        {
          onClick: () => {
            void audioRuntime
              .runManualCommand("play", { effectId: "test" })
              .then((outcome) => setStatus(outcome.status));
          },
        },
        status,
      );
    },
  };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  observed.runtimes.length = 0;
});

it("StrictMode creates a fresh runtime per setup and disposes on route exit", async () => {
  vi.spyOn(WebAudioFacade.prototype, "start").mockResolvedValue();
  vi.spyOn(WebAudioFacade.prototype, "applyProfile").mockResolvedValue();
  vi.spyOn(WebAudioFacade.prototype, "rampMasterGain").mockResolvedValue();
  const dispose = vi.spyOn(AudioRuntime.prototype, "dispose");
  const view = render(
    <StrictMode>
      <DashboardRoute />
    </StrictMode>,
  );
  const button = await screen.findByRole("button", { name: "idle" });
  const active = observed.runtimes.at(-1)!;
  expect(dispose).toHaveBeenCalledTimes(1);
  expect(dispose.mock.contexts).not.toContain(active);
  fireEvent.click(button);
  await screen.findByRole("button", { name: "applied" });
  view.unmount();
  await waitFor(() => expect(dispose).toHaveBeenCalledTimes(2));
  expect(dispose.mock.contexts).toContain(active);
  await expect(
    active.runManualCommand("play", { effectId: "after-exit" }),
  ).resolves.toMatchObject({ status: "failed" });
  render(
    <StrictMode>
      <DashboardRoute />
    </StrictMode>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "idle" }));
  await screen.findByRole("button", { name: "applied" });
  expect(observed.runtimes.at(-1)).not.toBe(active);
});
