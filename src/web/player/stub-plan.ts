import type {
  PlaybackPlan,
  PlaybackPlanSource,
  PlanTrack,
} from "./contracts.js";

export const DEFAULT_STUB_CROSSFADE_MS = 6_000;

/**
 * Local stub plan source: builds a plan from a static track list until the
 * server-side playback plan API is wired in by the integrator. Tracks must
 * already satisfy the /library/ URL contract.
 */
export function createLocalStubPlanSource(
  tracks: readonly PlanTrack[],
  crossfadeMs: number = DEFAULT_STUB_CROSSFADE_MS,
): PlaybackPlanSource {
  let cached: PlaybackPlan | null = null;
  return {
    kind: "local-stub",
    load(): Promise<PlaybackPlan> {
      if (cached === null) {
        cached = {
          steps: tracks.map((track) => ({ track, crossfadeMs })),
        };
      }
      return Promise.resolve(cached);
    },
  };
}
