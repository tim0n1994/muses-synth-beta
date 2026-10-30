import type {
  JourneySnapshot,
  JourneySummary,
  ReplayPlan,
  ReplayTrack,
} from "./types.js";

/**
 * Typed browser client for the batch-2 journey/replay API. Bearer token
 * comes from the auth store; server error envelopes surface as
 * ReplayApiError carrying the envelope code (UNKNOWN_JOURNEY /
 * UNKNOWN_REPLAY / ...). POST renderReplay sends an empty JSON object —
 * the app-wide security layer requires application/json on mutations.
 */

export class ReplayApiError extends Error {
  public constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ReplayApiError";
  }
}

export interface ReplayApiClientOptions {
  readonly baseUrl: string;
  readonly token: string;
  readonly fetchFn?: typeof fetch;
}

/** A replay plan plus the playable metadata for its tracks. */
export interface ReplayBundle {
  readonly plan: ReplayPlan;
  readonly tracks: readonly ReplayTrack[];
}

interface ReplayResponseDto {
  readonly replay: ReplayPlan;
  readonly tracks?: readonly ReplayTrack[];
}

const parseReplayBundle = (dto: ReplayResponseDto): ReplayBundle => ({
  plan: dto.replay,
  tracks: Array.isArray(dto.tracks) ? dto.tracks : [],
});

export interface ReplayApiClient {
  listJourneys(): Promise<readonly JourneySummary[]>;
  getJourney(journeyId: string): Promise<JourneySnapshot>;
  renderReplay(journeyId: string): Promise<ReplayBundle>;
  getReplay(journeyId: string): Promise<ReplayBundle>;
}

interface ErrorEnvelope {
  readonly error?: {
    readonly code?: string;
    readonly message?: string;
  };
}

export const createReplayApiClient = (
  options: ReplayApiClientOptions,
): ReplayApiClient => {
  const doFetch = options.fetchFn ?? globalThis.fetch.bind(globalThis);
  const request = async <T>(
    method: "GET" | "POST",
    path: string,
  ): Promise<T> => {
    const response = await doFetch(`${options.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${options.token}`,
        ...(method === "POST" ? { "content-type": "application/json" } : {}),
      },
      ...(method === "POST" ? { body: "{}" } : {}),
    });
    if (!response.ok) {
      let code = "REPLAY_API_HTTP_ERROR";
      let message = `Replay API request failed with ${response.status}`;
      try {
        const envelope = (await response.json()) as ErrorEnvelope | null;
        if (
          envelope !== null &&
          typeof envelope === "object" &&
          envelope.error !== undefined
        ) {
          if (typeof envelope.error.code === "string") {
            code = envelope.error.code;
          }
          if (typeof envelope.error.message === "string") {
            message = envelope.error.message;
          }
        }
      } catch {
        // Non-JSON error body: keep the generic code.
      }
      throw new ReplayApiError(response.status, code, message);
    }
    return (await response.json()) as T;
  };

  return {
    listJourneys: async () => {
      const body = await request<{ items: JourneySummary[] }>(
        "GET",
        "/api/v1/journeys",
      );
      return body.items;
    },
    getJourney: async (journeyId) => {
      const body = await request<{ journey: JourneySnapshot }>(
        "GET",
        `/api/v1/journeys/${encodeURIComponent(journeyId)}`,
      );
      return body.journey;
    },
    renderReplay: async (journeyId) =>
      parseReplayBundle(
        await request<ReplayResponseDto>(
          "POST",
          `/api/v1/journeys/${encodeURIComponent(journeyId)}/replay`,
        ),
      ),
    getReplay: async (journeyId) =>
      parseReplayBundle(
        await request<ReplayResponseDto>(
          "GET",
          `/api/v1/journeys/${encodeURIComponent(journeyId)}/replay`,
        ),
      ),
  };
};
