import { describe, expect, it, vi } from "vitest";

import { MAX_GAIN } from "../../audio/volume";
import { dispatchRegistryAction } from "../registry-actions";
import type { DashboardRegistryActions } from "../types";

function createActions(): DashboardRegistryActions & {
  calls: Record<string, unknown[]>;
} {
  const calls: Record<string, unknown[]> = {};
  const record =
    (name: string) =>
    (...args: unknown[]): void => {
      (calls[name] ??= []).push(args);
    };
  return {
    calls,
    refresh: vi.fn(),
    loadMoreEvents: vi.fn(),
    setAudioPlaying: record("setAudioPlaying"),
    setAudioVolume: record("setAudioVolume"),
    undoDecision: record("undoDecision"),
    requestLlmNarration: record("requestLlmNarration"),
    requestLlmSummary: record("requestLlmSummary"),
  };
}

describe("dispatchRegistryAction", () => {
  it("connects the transport controls to the dashboard handlers", () => {
    // Regression guard: the composition root used to pass
    // `onAction: () => undefined`, so every control on the Observatory was
    // inert — the audio engine could be mounted and still never be reached.
    const actions = createActions();

    dispatchRegistryAction(
      { componentId: "audio.control", name: "audio.play" },
      actions,
    );
    dispatchRegistryAction(
      { componentId: "audio.control", name: "audio.pause" },
      actions,
    );

    expect(actions.calls.setAudioPlaying).toEqual([[true], [false]]);
  });

  it("routes volume changes with a clamped integer", () => {
    const actions = createActions();

    dispatchRegistryAction(
      {
        componentId: "audio.control",
        name: "audio.volume",
        payload: { volume: 62.4 },
      },
      actions,
    );
    dispatchRegistryAction(
      {
        componentId: "audio.control",
        name: "audio.volume",
        payload: { volume: 900 },
      },
      actions,
    );

    // The slider speaks percent of the executor's gain range. Passing the
    // raw percent through used to request gain 62 (clamped to 1.0) against a
    // 0.35 ceiling, so every drag failed: 117 MANUAL_VOLUME failures in the
    // only real session on record (2026-08-21).
    expect(actions.calls.setAudioVolume).toEqual([
      [0.62 * MAX_GAIN],
      [MAX_GAIN],
    ]);
  });

  it("unmutes to a gain the executor accepts", () => {
    const actions = createActions();

    dispatchRegistryAction(
      { componentId: "audio.control", name: "audio.unmute" },
      actions,
    );

    const [[gain]] = actions.calls.setAudioVolume as [[number]];
    expect(gain).toBeGreaterThan(0);
    expect(gain).toBeLessThanOrEqual(MAX_GAIN);
  });

  it("expresses mute as a real gain change the server can audit", () => {
    const actions = createActions();

    dispatchRegistryAction(
      { componentId: "audio.control", name: "audio.mute" },
      actions,
    );

    expect(actions.calls.setAudioVolume).toEqual([[0]]);
  });

  it("ignores a malformed volume payload instead of sending garbage", () => {
    const actions = createActions();

    for (const payload of [
      undefined,
      null,
      {},
      { volume: "loud" },
      { volume: NaN },
    ]) {
      dispatchRegistryAction(
        { componentId: "audio.control", name: "audio.volume", payload },
        actions,
      );
    }

    expect(actions.calls.setAudioVolume).toBeUndefined();
  });

  it("routes the decision undo", () => {
    const actions = createActions();

    dispatchRegistryAction(
      { componentId: "decision.card", name: "decision.undo" },
      actions,
    );

    expect(actions.calls.undoDecision).toEqual([[]]);
  });

  it("routes narration and summary requests to the generation handlers", () => {
    const actions = createActions();

    dispatchRegistryAction(
      { componentId: "llm.narration", name: "llm.narrate" },
      actions,
    );
    dispatchRegistryAction(
      {
        componentId: "llm.narration",
        name: "llm.summarize",
        payload: { windowMinutes: 45 },
      },
      actions,
    );

    expect(actions.calls.requestLlmNarration).toEqual([[]]);
    expect(actions.calls.requestLlmSummary).toEqual([[45]]);
  });

  it("clamps the summary window to the server range and defaults to an hour", () => {
    const actions = createActions();

    dispatchRegistryAction(
      {
        componentId: "llm.narration",
        name: "llm.summarize",
        payload: { windowMinutes: 9_999 },
      },
      actions,
    );
    dispatchRegistryAction(
      {
        componentId: "llm.narration",
        name: "llm.summarize",
        payload: { windowMinutes: 1 },
      },
      actions,
    );
    dispatchRegistryAction(
      { componentId: "llm.narration", name: "llm.summarize" },
      actions,
    );
    dispatchRegistryAction(
      {
        componentId: "llm.narration",
        name: "llm.summarize",
        payload: { windowMinutes: "an hour" },
      },
      actions,
    );

    expect(actions.calls.requestLlmSummary).toEqual([[240], [15], [60], [60]]);
  });
});
