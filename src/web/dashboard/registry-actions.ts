import { percentToGain } from "../audio/volume";
import type { RegistryAction } from "../registry/types";
import type { DashboardRegistryActions } from "./types";

/**
 * Routes a registry component's action to the dashboard's handler for it.
 *
 * The two sides of this contract both existed and were never joined: the
 * composition root passed `onAction: () => undefined` and discarded the
 * context the shell handed it, so every interactive control on the Observatory
 * — play, pause, mute, volume, undo — was inert. The audio engine could be
 * mounted and still make no sound, because the click never reached it.
 */
/** Unmute without a remembered level lands near the profiles' default gains. */
const UNMUTE_PERCENT = 50;

export function dispatchRegistryAction(
  action: RegistryAction,
  actions: DashboardRegistryActions,
): void {
  switch (action.name) {
    case "audio.play":
      actions.setAudioPlaying(true);
      return;
    case "audio.pause":
      actions.setAudioPlaying(false);
      return;
    case "audio.mute":
      // Mute is expressed as a volume floor: the effect ledger records a real
      // gain change, so the server sees what the user actually did rather than
      // a UI-only flag it cannot audit.
      actions.setAudioVolume(0);
      return;
    case "audio.unmute":
      actions.setAudioVolume(
        percentToGain(readVolume(action.payload) ?? UNMUTE_PERCENT),
      );
      return;
    case "audio.volume": {
      const volume = readVolume(action.payload);
      if (volume !== null) {
        actions.setAudioVolume(percentToGain(volume));
      }
      return;
    }
    case "decision.undo":
      actions.undoDecision();
      return;
    case "llm.narrate":
      actions.requestLlmNarration();
      return;
    case "llm.summarize":
      actions.requestLlmSummary(readWindowMinutes(action.payload) ?? 60);
      return;
    default: {
      const exhaustive: never = action.name;
      return exhaustive;
    }
  }
}

/**
 * Registry components send a summary window in minutes; anything absent or
 * non-finite falls back to the default hour, and finite values are clamped
 * to the server's accepted 15..240 range.
 */
function readWindowMinutes(payload: unknown): number | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const value = (payload as { windowMinutes?: unknown }).windowMinutes;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return Math.max(15, Math.min(240, Math.round(value)));
}

/** Registry components report volume as 0–100; anything else is ignored. */
function readVolume(payload: unknown): number | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const value = (payload as { volume?: unknown }).volume;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}
