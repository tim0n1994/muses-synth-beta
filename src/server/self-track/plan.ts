import { createHash } from "node:crypto";

import type {
  IntensityLevel,
  PulseSnapshot,
  RhythmLevel,
} from "../vibe-signal/model.js";

/**
 * Pure playback-plan mathematics for the self track (v0.7 batch 1).
 *
 * Everything here is deterministic and side-effect free: pulse levels map to
 * a V2 signature bucket, a seed derived from (user, snapshot) picks a stable
 * rotation inside that bucket, and the emotion modulation decides how steps
 * enter (V2: emotion modulates transitions, it never picks a bucket). The
 * service layer owns all IO; these functions are unit-tested without a
 * database.
 */

/** A self-pool library row as aliased by the service SELECT. */
export interface LibraryTrackRow {
  readonly id: string;
  readonly bucket: string;
  readonly title: string;
  readonly author: string;
  readonly license: string;
  readonly licenseUrl: string;
  /** Relative to the static library root, e.g. self/self_mid_mid/<id>.opus. */
  readonly audioPath: string;
  readonly durationSeconds: number;
}

/** The plan DTO as consumed by the web player (src/web/player/contracts.ts). */
export interface PlanTrackDto {
  readonly trackId: string;
  readonly url: string;
  readonly title: string;
  readonly artist: string;
  readonly license: string;
  readonly licenseUrl: string;
  readonly durationMs: number;
}

export interface PlanStepDto {
  readonly track: PlanTrackDto;
  readonly crossfadeMs: number;
}

export interface PlaybackPlanDto {
  readonly steps: readonly PlanStepDto[];
}

/** V9 default when the pulse has no opinion: the minimal-electronic window. */
export const DEFAULT_PLAN_BUCKET = "self_mid_mid";

/** Matches the web stub's 6s crossfade so flag-on/off feel the same. */
export const DEFAULT_CROSSFADE_MS = 6_000;

export const MAX_CROSSFADE_MS = 12_000;

const PACE_OF: Readonly<Record<RhythmLevel, "slow" | "mid" | "fast">> = {
  SLOW: "slow",
  STEADY: "mid",
  FAST: "fast",
  UNKNOWN: "mid",
};

const ENERGY_OF: Readonly<Record<IntensityLevel, "low" | "mid" | "high">> = {
  CALM: "low",
  STEADY: "mid",
  INTENSE: "high",
  UNKNOWN: "mid",
};

const ENERGY_ORDER: readonly ("low" | "mid" | "high")[] = [
  "low",
  "mid",
  "high",
];

/**
 * Maps pulse levels to the self bucket (V2: rhythm 3 x intensity 3; UNKNOWN
 * falls back to the mid/mid signature default). `energyBias` comes from the
 * emotion modulation — -1 leans to the lower-energy neighbour, +1 upward —
 * and is clamped at the bucket grid edges.
 */
export function resolveTargetBucket(
  rhythm: RhythmLevel,
  intensity: IntensityLevel,
  energyBias: number = 0,
): string {
  const pace = PACE_OF[rhythm];
  let energyIndex = ENERGY_ORDER.indexOf(ENERGY_OF[intensity]);
  if (energyBias <= -1) {
    energyIndex = Math.max(0, energyIndex - 1);
  } else if (energyBias >= 1) {
    energyIndex = Math.min(ENERGY_ORDER.length - 1, energyIndex + 1);
  }
  return `self_${pace}_${ENERGY_ORDER[energyIndex]}`;
}

/**
 * Deterministic rotation seed: the same user + the same pulse snapshot must
 * produce the same plan (repeatable reads), while a moved pulse re-rolls it
 * (an event can change the next track within the 60s budget).
 */
export function planSeedFor(
  userId: string | null,
  snapshot: PulseSnapshot | null,
): number {
  const digest = createHash("sha256")
    .update(
      `${userId ?? "global"}|${snapshot?.asOf ?? "static"}|${
        snapshot?.inputDigest ?? ""
      }`,
      "utf8",
    )
    .digest("hex");
  return Number.parseInt(digest.slice(0, 8), 16);
}

const toTrackDto = (row: LibraryTrackRow): PlanTrackDto => ({
  trackId: row.id,
  url: `/library/${row.audioPath}`,
  title: row.title,
  artist: row.author,
  license: row.license,
  licenseUrl: row.licenseUrl,
  durationMs: Math.max(1, Math.round(row.durationSeconds * 1000)),
});

/**
 * Picks `stepCount` tracks from `bucketRows` starting at `seed % len`,
 * wrapping around. With two or more tracks in the bucket no two adjacent
 * steps repeat; a single-track bucket (not the case in the 60-track pilot)
 * legitimately repeats its only track.
 *
 * `avoidTrackId` (the rotation-avoidance knob, R2 fix for the round-1 §9-4
 * live-side gap): when the rotation would open on that track, it opens on
 * the next one instead. Only a moved pulse passes it — the service keeps
 * repeatable reads for an unchanged snapshot, and a moved pulse must change
 * the next track even when the re-rolled seed lands on the track that is
 * already playing (the R2 review measured such a seed holding the plan for
 * 62.94s, past the 60s event→track-change budget). Ignored for a
 * single-track bucket, which has nothing else to play.
 */
export function buildPlaybackPlan(
  bucketRows: readonly LibraryTrackRow[],
  seed: number,
  stepCount: number,
  crossfadeMs: number,
  avoidTrackId?: string,
): PlaybackPlanDto {
  if (bucketRows.length === 0) {
    throw new TypeError("buildPlaybackPlan requires a non-empty bucket");
  }
  const safeCrossfade = Math.min(
    MAX_CROSSFADE_MS,
    Math.max(0, Math.round(crossfadeMs)),
  );
  const rows = [...bucketRows].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  let offset = seed % rows.length;
  if (
    avoidTrackId !== undefined &&
    rows.length > 1 &&
    rows[offset]!.id === avoidTrackId
  ) {
    offset = (offset + 1) % rows.length;
  }
  const steps: PlanStepDto[] = [];
  for (let index = 0; index < stepCount; index += 1) {
    steps.push({
      track: toTrackDto(rows[(offset + index) % rows.length]!),
      crossfadeMs: safeCrossfade,
    });
  }
  return { steps };
}

/**
 * Crossfade policy from the pulse's transition modulation: hard cuts enter
 * steps with 0 ms overlap, everything else uses the modulated (and clamped)
 * crossfade. A missing pulse keeps the 6s default.
 */
export function crossfadeMsOf(snapshot: PulseSnapshot | null): number {
  const modulation = snapshot?.emotion.transitionModulation;
  if (modulation === undefined) {
    return DEFAULT_CROSSFADE_MS;
  }
  return modulation.hardCut ? 0 : modulation.crossfadeMs;
}
