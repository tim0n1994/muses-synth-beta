/**
 * Contracts for the v0.7 self-track player.
 *
 * The server (or, until it is wired, a local stub) sends a *playback plan*:
 * which track comes next, when the transition happens, and how the two decks
 * overlap. Audio itself is always a static library file consumed over HTTP
 * Range by the browser's media element — see `plan.ts` for the URL contract
 * and `static-only.test.ts` for the enforced evidence.
 */

/** One library track as referenced by a playback plan. */
export interface PlanTrack {
  readonly trackId: string;
  /** Same-origin static path under `/library/` (enforced by validatePlan). */
  readonly url: string;
  readonly title: string;
  readonly artist: string;
  /** License identifier, e.g. "CC-BY 4.0" — attribution obligation. */
  readonly license: string;
  readonly licenseUrl: string;
  readonly durationMs: number;
}

/**
 * One step of a plan. `crossfadeMs` is how this step *enters*: the overlap
 * with the previous track (0 = hard cut at the previous track's end). For the
 * first step it is the fade-in duration from silence.
 */
export interface PlanStep {
  readonly track: PlanTrack;
  readonly crossfadeMs: number;
}

/** An ordered playback plan: "next / when / how to transition". */
export interface PlaybackPlan {
  readonly steps: readonly PlanStep[];
}

/** Where a plan comes from. The server API lands with the integrator. */
export interface PlaybackPlanSource {
  readonly kind: "server-api" | "local-stub";
  load(): Promise<PlaybackPlan>;
}
