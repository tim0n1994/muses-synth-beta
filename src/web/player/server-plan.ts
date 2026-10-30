import type {
  PlaybackPlan,
  PlaybackPlanSource,
  PlanStep,
  PlanTrack,
} from "./contracts.js";
import { validatePlan } from "./plan.js";
import { createAuthorizedFetch } from "../auth/authorized-fetch.js";

/**
 * Server-backed plan source (stage-3 wiring): GET /api/v1/self-track/plan.
 *
 * The endpoint exists only while MUSES_V07 is enabled on the server; when
 * the switch is off it answers the foundation 404 and this source rejects
 * with a status-tagged error the player surfaces through its alert region.
 * Audio never flows through this API — the plan is metadata; tracks load as
 * static /library/ files over HTTP Range (see static-only.test.ts).
 */
export const PLAN_API_PATH = "/api/v1/self-track/plan";

interface PlanTrackDto {
  readonly trackId: string;
  readonly url: string;
  readonly title: string;
  readonly artist: string;
  readonly license: string;
  readonly licenseUrl: string;
  readonly durationMs: number;
}

const isTrackDto = (value: unknown): value is PlanTrackDto => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.trackId === "string" &&
    typeof candidate.url === "string" &&
    typeof candidate.title === "string" &&
    typeof candidate.artist === "string" &&
    typeof candidate.license === "string" &&
    typeof candidate.licenseUrl === "string" &&
    typeof candidate.durationMs === "number"
  );
};

const parsePlan = (dto: unknown): PlaybackPlan => {
  if (typeof dto !== "object" || dto === null) {
    throw new Error("Plan response was not an object");
  }
  const rawSteps = (dto as Record<string, unknown>).steps;
  if (!Array.isArray(rawSteps)) {
    throw new Error("Plan response had no steps array");
  }
  const steps: PlanStep[] = rawSteps.map((rawStep) => {
    if (typeof rawStep !== "object" || rawStep === null) {
      throw new Error("Plan step was not an object");
    }
    const step = rawStep as Record<string, unknown>;
    if (!isTrackDto(step.track) || typeof step.crossfadeMs !== "number") {
      throw new Error("Plan step was malformed");
    }
    const track: PlanTrack = {
      trackId: step.track.trackId,
      url: step.track.url,
      title: step.track.title,
      artist: step.track.artist,
      license: step.track.license,
      licenseUrl: step.track.licenseUrl,
      durationMs: step.track.durationMs,
    };
    return { track, crossfadeMs: step.crossfadeMs };
  });
  const problems = validatePlan({ steps });
  if (problems.length > 0) {
    throw new Error(`Plan rejected by client validation: ${problems[0]}`);
  }
  return { steps };
};

export interface ServerPlanSourceOptions {
  readonly fetchFn?: typeof fetch;
  readonly path?: string;
}

export function createServerPlanSource(
  options: ServerPlanSourceOptions = {},
): PlaybackPlanSource {
  const doFetch = options.fetchFn ?? createAuthorizedFetch();
  const path = options.path ?? PLAN_API_PATH;
  return {
    kind: "server-api",
    load: async () => {
      let response: Response;
      try {
        response = await doFetch(path, {
          headers: { accept: "application/json" },
        });
      } catch (cause: unknown) {
        throw new Error(
          `Self-track plan request failed: ${
            cause instanceof Error ? cause.message : String(cause)
          }`,
        );
      }
      if (!response.ok) {
        throw new Error(`Self-track plan unavailable (${response.status})`);
      }
      return parsePlan(await response.json());
    },
  };
}
