export type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export interface ApiResponse {
  readonly status: number;
  readonly headers: Headers;
  readonly text: string;
  readonly json: unknown;
}

export interface SuccessEnvelope<T> {
  readonly ok: true;
  readonly data: T;
  readonly meta: {
    readonly requestId: string;
    readonly timestamp: string;
    readonly schemaVersion: "0.1";
  };
}

export interface ErrorEnvelope {
  readonly ok: false;
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details?: JsonValue;
  };
  readonly meta: {
    readonly requestId: string;
    readonly timestamp: string;
    readonly schemaVersion: "0.1";
  };
}
