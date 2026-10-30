import { ContextDomainError, invalidCursor } from "./errors.js";

interface CursorPayload {
  readonly version: 1;
  readonly afterSequence: number;
}

export const encodeContextCursor = (afterSequence: number): string => {
  const payload: CursorPayload = { version: 1, afterSequence };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
};

export const decodeContextCursor = (cursor: string | undefined): number => {
  if (cursor === undefined) {
    return 0;
  }

  try {
    const decoded: unknown = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    );
    if (!isCursorPayload(decoded)) {
      throw invalidCursor(
        "Cursor payload is malformed or uses an unsupported version.",
      );
    }
    return decoded.afterSequence;
  } catch (error: unknown) {
    if (error instanceof ContextDomainError) {
      throw error;
    }
    throw invalidCursor("Cursor is not valid base64url JSON.");
  }
};

const isCursorPayload = (value: unknown): value is CursorPayload => {
  if (!isRecord(value)) {
    return false;
  }
  return (
    value.version === 1 &&
    typeof value.afterSequence === "number" &&
    Number.isSafeInteger(value.afterSequence) &&
    value.afterSequence >= 0
  );
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
