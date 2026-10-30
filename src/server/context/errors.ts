export type ContextErrorCode =
  | "CONTEXT_RETENTION_DISABLED"
  | "CONTEXT_INVALID_EVENT"
  | "CONTEXT_IDEMPOTENCY_CONFLICT"
  | "CONTEXT_INVALID_CURSOR"
  | "CONTEXT_STORAGE_FAILURE";

export class ContextDomainError extends Error {
  public readonly code: ContextErrorCode;
  public readonly statusCode: number;
  public readonly details: Readonly<Record<string, unknown>> | undefined;

  public constructor(
    code: ContextErrorCode,
    message: string,
    statusCode: number,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = "ContextDomainError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export const invalidEvent = (
  message: string,
  details?: Readonly<Record<string, unknown>>,
): ContextDomainError =>
  new ContextDomainError("CONTEXT_INVALID_EVENT", message, 400, details);

export const invalidCursor = (message: string): ContextDomainError =>
  new ContextDomainError("CONTEXT_INVALID_CURSOR", message, 400);

export const idempotencyConflict = (
  source: string,
  id: string,
): ContextDomainError =>
  new ContextDomainError(
    "CONTEXT_IDEMPOTENCY_CONFLICT",
    "An event with the same CloudEvents source and id already exists with different content.",
    409,
    { source, id },
  );

export const storageFailure = (
  operation: string,
  cause: unknown,
): ContextDomainError => {
  const causeMessage =
    cause instanceof Error ? cause.message : "Unknown storage error";
  return new ContextDomainError(
    "CONTEXT_STORAGE_FAILURE",
    `Context storage operation failed: ${operation}.`,
    503,
    { cause: causeMessage },
  );
};
