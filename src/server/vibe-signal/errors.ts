export type PulseErrorCode =
  | "PULSE_INVALID_REQUEST"
  | "PULSE_REPLAY_LIMIT_EXCEEDED"
  | "PULSE_STORAGE_FAILURE";

export class PulseDomainError extends Error {
  public readonly code: PulseErrorCode;
  public readonly statusCode: number;
  public readonly details: Readonly<Record<string, unknown>> | undefined;

  public constructor(
    code: PulseErrorCode,
    message: string,
    statusCode: number,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = "PulseDomainError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export const invalidPulseRequest = (message: string): PulseDomainError =>
  new PulseDomainError("PULSE_INVALID_REQUEST", message, 400);

export const pulseReplayLimitExceeded = (maxEvents: number): PulseDomainError =>
  new PulseDomainError(
    "PULSE_REPLAY_LIMIT_EXCEEDED",
    `Pulse replay exceeds the configured maximum of ${maxEvents} events.`,
    413,
    { maxEvents },
  );

export const pulseStorageFailure = (
  operation: string,
  cause: unknown,
): PulseDomainError => {
  const causeMessage =
    cause instanceof Error ? cause.message : "Unknown storage error";
  return new PulseDomainError(
    "PULSE_STORAGE_FAILURE",
    `Pulse storage operation failed: ${operation}.`,
    503,
    { cause: causeMessage },
  );
};
