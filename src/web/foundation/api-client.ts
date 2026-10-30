export interface ApiIssue {
  readonly message: string;
  readonly path: string;
}

export interface ApiErrorDetails {
  readonly code: string;
  readonly issues?: readonly ApiIssue[];
  readonly message: string;
  readonly requestId?: string;
}

export class ApiClientError extends Error {
  readonly code: string;
  readonly issues: readonly ApiIssue[] | undefined;
  readonly requestId: string | undefined;
  readonly status: number;

  constructor(status: number, details: ApiErrorDetails) {
    super(details.message);
    this.name = "ApiClientError";
    this.code = details.code;
    this.issues = details.issues;
    this.requestId = details.requestId;
    this.status = status;
  }
}

export interface ApiRequestOptions<TBody = unknown> {
  readonly body?: TBody;
  readonly headers?: HeadersInit;
  readonly method?: "DELETE" | "GET" | "PATCH" | "POST" | "PUT";
  readonly signal?: AbortSignal;
}

export interface ApiClient {
  get<TResponse>(
    path: string,
    options?: Omit<ApiRequestOptions, "body" | "method">,
  ): Promise<TResponse>;
  request<TResponse, TBody = unknown>(
    path: string,
    options?: ApiRequestOptions<TBody>,
  ): Promise<TResponse>;
}

export interface CreateApiClientOptions {
  readonly baseUrl?: string;
  readonly fetchImplementation?: typeof fetch;
  readonly timeoutMs?: number;
}

interface ErrorEnvelopeCandidate {
  readonly error?: {
    readonly code?: unknown;
    readonly issues?: unknown;
    readonly message?: unknown;
    readonly requestId?: unknown;
  };
}

const JSON_METHODS = new Set(["PATCH", "POST", "PUT"]);

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

function parseIssues(value: unknown): readonly ApiIssue[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const issues = value.flatMap((candidate): ApiIssue[] => {
    if (!isRecord(candidate)) {
      return [];
    }

    const path = candidate.path;
    const message = candidate.message;
    return typeof path === "string" && typeof message === "string"
      ? [{ message, path }]
      : [];
  });

  return issues.length === 0 ? undefined : issues;
}

function parseErrorDetails(
  value: unknown,
  fallbackMessage: string,
): ApiErrorDetails {
  if (!isRecord(value)) {
    return { code: "HTTP_ERROR", message: fallbackMessage };
  }

  const candidate = value as ErrorEnvelopeCandidate;
  const error = candidate.error;
  if (!isRecord(error)) {
    return { code: "HTTP_ERROR", message: fallbackMessage };
  }

  const issues = parseIssues(error.issues);
  return {
    code: typeof error.code === "string" ? error.code : "HTTP_ERROR",
    ...(issues === undefined ? {} : { issues }),
    message:
      typeof error.message === "string" ? error.message : fallbackMessage,
    ...(typeof error.requestId === "string"
      ? { requestId: error.requestId }
      : {}),
  };
}

async function readJson(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    if (response.status === 204) {
      return undefined;
    }
    throw new ApiClientError(response.status, {
      code: "INVALID_RESPONSE",
      message: "The local server returned a non-JSON response",
    });
  }

  try {
    return await response.json();
  } catch {
    throw new ApiClientError(response.status, {
      code: "INVALID_RESPONSE",
      message: "The local server returned malformed JSON",
    });
  }
}

function createRequestSignal(
  parent: AbortSignal | undefined,
  timeoutMs: number,
): {
  readonly cleanup: () => void;
  readonly signal: AbortSignal;
} {
  const controller = new AbortController();
  const onAbort = (): void => controller.abort(parent?.reason);
  if (parent?.aborted === true) {
    controller.abort(parent.reason);
  } else {
    parent?.addEventListener("abort", onAbort, { once: true });
  }

  const timeout = window.setTimeout(() => {
    controller.abort(new DOMException("Request timed out", "TimeoutError"));
  }, timeoutMs);

  return {
    cleanup() {
      window.clearTimeout(timeout);
      parent?.removeEventListener("abort", onAbort);
    },
    signal: controller.signal,
  };
}

function normalizePath(path: string): string {
  if (!path.startsWith("/")) {
    throw new TypeError('API paths must begin with "/"');
  }
  return path;
}

export function createApiClient(
  options: CreateApiClientOptions = {},
): ApiClient {
  const baseUrl = options.baseUrl ?? "";
  const fetchImplementation =
    options.fetchImplementation ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = options.timeoutMs ?? 10_000;

  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new TypeError("API timeout must be a positive integer");
  }

  const request = async <TResponse, TBody = unknown>(
    path: string,
    requestOptions: ApiRequestOptions<TBody> = {},
  ): Promise<TResponse> => {
    const method = requestOptions.method ?? "GET";
    const headers = new Headers(requestOptions.headers);
    headers.set("accept", "application/json");

    let body: BodyInit | undefined;
    if (JSON_METHODS.has(method)) {
      headers.set("content-type", "application/json");
      body = JSON.stringify(requestOptions.body ?? {});
    }

    const requestSignal = createRequestSignal(requestOptions.signal, timeoutMs);
    try {
      const response = await fetchImplementation(
        `${baseUrl}${normalizePath(path)}`,
        {
          ...(body === undefined ? {} : { body }),
          credentials: "same-origin",
          headers,
          method,
          signal: requestSignal.signal,
        },
      );
      const payload = await readJson(response);

      if (!response.ok) {
        throw new ApiClientError(
          response.status,
          parseErrorDetails(
            payload,
            `Request failed with status ${response.status}`,
          ),
        );
      }

      return payload as TResponse;
    } catch (error: unknown) {
      if (error instanceof ApiClientError) {
        throw error;
      }

      if (requestSignal.signal.aborted) {
        throw new ApiClientError(0, {
          code: "REQUEST_ABORTED",
          message: "The request was cancelled or timed out",
        });
      }

      throw new ApiClientError(0, {
        code: "NETWORK_ERROR",
        message: "The local server could not be reached",
      });
    } finally {
      requestSignal.cleanup();
    }
  };

  return {
    get<TResponse>(path: string, requestOptions = {}) {
      return request<TResponse>(path, { ...requestOptions, method: "GET" });
    },
    request,
  };
}

export const apiClient = createApiClient();
