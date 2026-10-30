export const SCHEMA_VERSION = "muses.v0.1" as const;

export type SchemaVersion = typeof SCHEMA_VERSION;

export const MAX_EVENT_BYTES = 65_536;
export const MAX_JSON_DEPTH = 64;
export const PROBABILITY_NORMALIZATION_TOLERANCE = 1e-6;

export const SENSITIVITY_TTL_LIMIT_SECONDS = {
  PUBLIC: 30 * 24 * 60 * 60,
  INTERNAL: 7 * 24 * 60 * 60,
  SENSITIVE: 24 * 60 * 60,
  RESTRICTED: 60 * 60,
} as const;

export type Sensitivity = keyof typeof SENSITIVITY_TTL_LIMIT_SECONDS;

export const CONTRACT_DEPENDENCIES = {
  "@sinclair/typebox": {
    version: "0.34.41",
    license: "MIT",
    reason: "Single runtime-schema and Static TypeScript type source.",
  },
  ajv: {
    version: "8.17.1",
    license: "MIT",
    reason:
      "Strict JSON Schema validation with deterministic error collection.",
  },
  "ajv-formats": {
    version: "3.0.1",
    license: "MIT",
    reason: "Standards-based date-time format validation for Ajv.",
  },
  vitest: {
    version: "3.2.4",
    license: "MIT",
    reason: "Node 22-compatible owned contract tests.",
  },
  typescript: {
    version: "5.8.3",
    license: "Apache-2.0",
    reason: "Strict TypeScript compilation baseline used by this delivery.",
  },
} as const;
