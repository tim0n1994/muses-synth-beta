export type BeliefErrorCode =
  "BELIEF_INVALID_REQUEST" | "BELIEF_STORAGE_FAILURE";

export class BeliefDomainError extends Error {
  public readonly code: BeliefErrorCode;
  public readonly statusCode: number;
  public readonly details: Readonly<Record<string, unknown>> | undefined;

  public constructor(
    code: BeliefErrorCode,
    message: string,
    statusCode: number,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = "BeliefDomainError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export const invalidBeliefRequest = (message: string): BeliefDomainError =>
  new BeliefDomainError("BELIEF_INVALID_REQUEST", message, 400);

export const beliefStorageFailure = (
  operation: string,
  cause: unknown,
): BeliefDomainError => {
  const causeMessage =
    cause instanceof Error ? cause.message : "Unknown storage error";
  return new BeliefDomainError(
    "BELIEF_STORAGE_FAILURE",
    `Belief storage operation failed: ${operation}.`,
    503,
    { cause: causeMessage },
  );
};
