import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { DashboardApi, PendingEffect } from "../dashboard/types.js";
import { useEffectCommands } from "../dashboard/hooks/useEffectCommands.js";
import { createTranslator } from "../i18n/index.js";
import { AudioRuntime } from "./audio-runtime.js";

afterEach(cleanup);

it("posts the actual failed automatic outcome and exposes its media failure", async () => {
  // A successful start followed by a failed automatic profile uses the same runtime.
  const workingRuntime = new AudioRuntime({
    manualCooldownMs: 0,
    facade: {
      start: async () => {},
      applyProfile: async (profile) => {
        if (profile.id === "audit") throw new Error("media decode failed");
      },
      rampMasterGain: async () => {},
      pause: async () => {},
      dispose: async () => {},
    },
  });
  await workingRuntime.runManualCommand("play", {
    effectId: "start",
    profile: "flow",
  });
  const postEffectOutcome = vi.fn(async () => ({ accepted: true }));
  const api = { postEffectOutcome } as unknown as DashboardApi;
  const pending: PendingEffect = {
    effectId: "auto",
    decisionId: "decision",
    profile: "audit",
    targetGain: 0.2,
    rampMs: 500,
    issuedAt: new Date().toISOString(),
  };
  const onAccepted = vi.fn();
  const isCurrent = () => true;
  const t = createTranslator("en");
  const { result } = renderHook(() =>
    useEffectCommands(api, workingRuntime, pending, onAccepted, isCurrent, t),
  );
  await waitFor(() =>
    expect(result.current.error?.message).toBe("media decode failed"),
  );
  expect(postEffectOutcome).toHaveBeenCalledWith(
    expect.objectContaining({
      status: "failed",
      reason: "AUDIO_FACADE_FAILURE",
      effectId: "auto",
    }),
    expect.any(AbortSignal),
  );
});
