import {
  isPublishResult,
  isReleaseArray,
  isSettingsDraft,
  isSettingsPreview,
  isSettingsSnapshot,
  type FieldViolation,
  type PublishResult,
  type SettingsDocument,
  type SettingsDraft,
  type SettingsPreview,
  type SettingsRelease,
  type SettingsSnapshot,
} from "../model/document";

/**
 * Typed access to the settings routes the Fastify plugin actually registers
 * (`src/server/settings/plugin.ts`). Paths and payload shapes here are the
 * server's; ADR-0001 makes `/api/settings/*` canonical alongside `/api/v1/*`.
 */
import { createAuthorizedFetch } from "../../auth/authorized-fetch.js";

const authorizedFetch = createAuthorizedFetch();

export interface SettingsClient {
  getSnapshot(signal?: AbortSignal): Promise<SettingsSnapshot>;
  saveDraft(
    input: SaveDraftInput,
    signal?: AbortSignal,
  ): Promise<SettingsDraft>;
  previewDraft(
    input: PreviewInput,
    signal?: AbortSignal,
  ): Promise<SettingsPreview>;
  publishDraft(
    input: PublishInput,
    signal?: AbortSignal,
  ): Promise<PublishResult>;
  getReleases(limit?: number, signal?: AbortSignal): Promise<SettingsRelease[]>;
  rollbackRelease(
    input: RollbackInput,
    signal?: AbortSignal,
  ): Promise<PublishResult>;
}

export interface SaveDraftInput {
  actor: string;
  reason: string;
  expectedRevision: number;
  document: SettingsDocument;
}

export interface PreviewInput {
  document: SettingsDocument;
  againstReleaseId?: string;
}

export interface PublishInput {
  actor: string;
  reason: string;
  expectedDraftRevision: number;
  expectedDraftChecksum: string;
}

export interface RollbackInput {
  releaseId: string;
  actor: string;
  reason: string;
  expectedCurrentReleaseId: string;
  expectedDraftRevision: number;
}

export class SettingsApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly violations: FieldViolation[] | undefined;

  constructor(
    status: number,
    code: string,
    message: string,
    violations?: FieldViolation[],
  ) {
    super(message);
    this.name = "SettingsApiError";
    this.status = status;
    this.code = code;
    this.violations = violations;
  }
}

/**
 * Raised for the server's 409 `SETTINGS_CONFLICT`, which means another writer
 * (a second tab, a script) advanced the draft or release. The server reports
 * which field diverged and both values; the workspace turns that into a
 * "reload the server draft" prompt rather than silently overwriting.
 */
export class SettingsConflictError extends Error {
  readonly field: string;
  readonly expected: unknown;
  readonly actual: unknown;

  constructor(
    message: string,
    field: string,
    expected: unknown,
    actual: unknown,
  ) {
    super(message);
    this.name = "SettingsConflictError";
    this.field = field;
    this.expected = expected;
    this.actual = actual;
  }
}

export interface CreateSettingsClientOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export function createSettingsClient(
  options: CreateSettingsClientOptions = {},
): SettingsClient {
  const baseUrl = options.baseUrl ?? "/api/settings";
  const fetchImpl =
    options.fetchImpl ??
    ((...args: Parameters<typeof fetch>) => authorizedFetch(...args));

  return {
    getSnapshot: (signal) =>
      request(
        fetchImpl,
        baseUrl,
        "",
        { signal },
        isSettingsSnapshot,
        "settings snapshot",
      ),
    saveDraft: (input, signal) =>
      request(
        fetchImpl,
        baseUrl,
        "/draft",
        { method: "PUT", signal, body: input },
        isSettingsDraft,
        "settings draft",
      ),
    previewDraft: (input, signal) =>
      request(
        fetchImpl,
        baseUrl,
        "/preview",
        { method: "POST", signal, body: input },
        isSettingsPreview,
        "settings preview",
      ),
    publishDraft: (input, signal) =>
      request(
        fetchImpl,
        baseUrl,
        "/publish",
        { method: "POST", signal, body: input },
        isPublishResult,
        "publish result",
      ),
    getReleases: (limit, signal) =>
      request(
        fetchImpl,
        baseUrl,
        limit === undefined ? "/releases" : `/releases?limit=${limit}`,
        { signal },
        isReleaseArray,
        "release history",
      ),
    rollbackRelease: ({ releaseId, ...body }, signal) =>
      request(
        fetchImpl,
        baseUrl,
        `/releases/${encodeURIComponent(releaseId)}/rollback`,
        { method: "POST", signal, body },
        isPublishResult,
        "rollback result",
      ),
  };
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT";
  body?: unknown;
  signal?: AbortSignal | undefined;
}

async function request<T>(
  fetchImpl: typeof fetch,
  baseUrl: string,
  path: string,
  options: RequestOptions,
  guard: (value: unknown) => value is T,
  responseName: string,
): Promise<T> {
  const init: RequestInit = {
    method: options.method ?? "GET",
    credentials: "same-origin",
  };
  if (options.body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(options.body);
  }
  if (options.signal !== undefined) {
    init.signal = options.signal;
  }
  const response = await fetchImpl(`${baseUrl}${path}`, init);

  const payload: unknown = await parseJson(response);
  if (!response.ok) {
    throw toDomainError(response.status, payload);
  }
  if (!guard(payload)) {
    throw new SettingsApiError(
      502,
      "INVALID_SETTINGS_RESPONSE",
      `The local settings server returned an invalid ${responseName}.`,
    );
  }
  return payload;
}

/**
 * Maps the plugin's `{ code, message, details }` error envelope onto the two
 * error classes the workspace reacts to. Validation details carry Ajv-shaped
 * issues (`instancePath`, `keyword`, `message`) which become field violations
 * keyed by dotted form path.
 */
function toDomainError(status: number, payload: unknown): Error {
  if (!isRecord(payload) || typeof payload["message"] !== "string") {
    return new SettingsApiError(
      status,
      "SETTINGS_HTTP_ERROR",
      `Settings request failed with HTTP ${status}.`,
    );
  }
  const code =
    typeof payload["code"] === "string" ? payload["code"] : "SETTINGS_ERROR";
  const message = payload["message"];
  const details = isRecord(payload["details"]) ? payload["details"] : undefined;

  if (code === "SETTINGS_CONFLICT") {
    return new SettingsConflictError(
      message,
      typeof details?.["field"] === "string" ? details["field"] : "unknown",
      details?.["expected"],
      details?.["actual"],
    );
  }
  return new SettingsApiError(status, code, message, readIssues(details));
}

function readIssues(
  details: Record<string, unknown> | undefined,
): FieldViolation[] | undefined {
  const issues = details?.["issues"];
  if (!Array.isArray(issues)) {
    return undefined;
  }
  const violations = issues.flatMap((issue): FieldViolation[] => {
    if (!isRecord(issue) || typeof issue["message"] !== "string") {
      return [];
    }
    const instancePath =
      typeof issue["instancePath"] === "string" ? issue["instancePath"] : "";
    return [
      {
        path: instancePath.replace(/^\//, "").replace(/\//g, "."),
        message: issue["message"],
        code:
          typeof issue["keyword"] === "string" ? issue["keyword"] : "schema",
      },
    ];
  });
  return violations.length === 0 ? undefined : violations;
}

async function parseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) {
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new SettingsApiError(
      response.status,
      "INVALID_JSON_RESPONSE",
      "The local settings server returned invalid JSON.",
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
