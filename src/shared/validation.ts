import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";
import type { Static, TSchema } from "@sinclair/typebox";
import {
  MAX_EVENT_BYTES,
  MAX_JSON_DEPTH,
  PROBABILITY_NORMALIZATION_TOLERANCE,
  SCHEMA_VERSION,
  SENSITIVITY_TTL_LIMIT_SECONDS,
} from "./constants";
import { canonicalJsonByteLength, hashCanonicalJson } from "./canonical-json";
import { ContractValidationError, type ValidationResult } from "./errors";
import type { ApiErrorCode, ApiErrorIssue } from "./schemas/api";
import type { Belief } from "./schemas/belief";
import type { DashboardComponent } from "./schemas/dashboard";
import type { Decision } from "./schemas/decision";
import type { Effect } from "./schemas/effect";
import type { ContextEvent } from "./schemas/event";
import type {
  SettingsDocument,
  SettingsDraft,
  SettingsHistory,
  SettingsPreview,
  SettingsRelease,
} from "./schemas/settings";
import {
  ApiErrorEnvelopeSchema,
  BeliefSchema,
  ContextEventSchema,
  DecisionSchema,
  EffectSchema,
  JsonApiEnvelopeSchema,
  SettingsDraftSchema,
  SettingsHistorySchema,
  SettingsPreviewSchema,
  SettingsReleaseSchema,
} from "./schemas";

const MAX_ISSUES = 64;
const MAX_ISSUE_PATH_LENGTH = 256;
const MAX_ISSUE_MESSAGE_LENGTH = 280;
const MAX_KEYWORD_LENGTH = 64;

const DANGEROUS_KEYS = new Set(["__proto__", "prototype", "constructor"]);

const EXECUTABLE_KEYS = new Set([
  "argv",
  "callback",
  "cmd",
  "command",
  "componentpath",
  "dangerouslysetinnerhtml",
  "dynamicimport",
  "eval",
  "executable",
  "function",
  "functionbody",
  "handler",
  "html",
  "import",
  "innerhtml",
  "javascript",
  "module",
  "modulepath",
  "script",
  "shell",
]);

const EXECUTABLE_URI_PREFIXES = [
  "javascript:",
  "vbscript:",
  "data:text/html",
  "data:application/javascript",
];

const EVENT_HANDLER_KEY_PATTERN =
  /^on(?:abort|animation(?:cancel|end|iteration|start)|auxclick|beforeinput|blur|cancel|change|click|close|contextmenu|copy|cut|dblclick|drag(?:end|enter|leave|over|start)?|drop|error|focus|formdata|input|invalid|key(?:down|press|up)|load|message|mouse(?:down|enter|leave|move|out|over|up)|offline|paste|pointer(?:cancel|down|enter|leave|move|out|over|rawupdate|up)|popstate|progress|reset|resize|scroll|securitypolicyviolation|select|slotchange|storage|submit|toggle|touch(?:cancel|end|move|start)|transition(?:cancel|end|run|start)|unload|wheel)$/iu;

const TIMESTAMP_PROPERTY_NAMES = new Set([
  "appliedAt",
  "createdAt",
  "expiresAt",
  "generatedAt",
  "observedAt",
  "occurredAt",
  "publishedAt",
  "revertedAt",
  "updatedAt",
]);

function truncate(value: string, maximum: number): string {
  const sanitized = value.replace(/[\u0000-\u001F\u007F]/gu, " ");
  return sanitized.length <= maximum
    ? sanitized
    : `${sanitized.slice(0, Math.max(0, maximum - 1))}…`;
}

function issue(
  code: ApiErrorCode,
  path: string,
  message: string,
  keyword?: string,
): ApiErrorIssue {
  const value: ApiErrorIssue = {
    code,
    path: truncate(path, MAX_ISSUE_PATH_LENGTH),
    message: truncate(message, MAX_ISSUE_MESSAGE_LENGTH),
  };
  if (keyword !== undefined) {
    value.keyword = truncate(keyword, MAX_KEYWORD_LENGTH);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isExecutableKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return EXECUTABLE_KEYS.has(normalized) || EVENT_HANDLER_KEY_PATTERN.test(key);
}

function inspectJsonOnly(
  value: unknown,
  path = "$",
  depth = 0,
  ancestors = new WeakSet<object>(),
): ApiErrorIssue[] {
  if (depth > MAX_JSON_DEPTH) {
    return [
      issue(
        "VALIDATION_FAILED",
        path,
        `Maximum JSON depth ${MAX_JSON_DEPTH} exceeded.`,
        "maxDepth",
      ),
    ];
  }

  if (value === null || typeof value === "boolean") {
    return [];
  }

  if (typeof value === "string") {
    const normalized = value.trimStart().toLowerCase();
    return EXECUTABLE_URI_PREFIXES.some((prefix) =>
      normalized.startsWith(prefix),
    )
      ? [
          issue(
            "EXECUTABLE_PAYLOAD",
            path,
            "Executable URI payloads are not allowed.",
            "executableUri",
          ),
        ]
      : [];
  }

  if (typeof value === "number") {
    return Number.isFinite(value)
      ? []
      : [
          issue(
            "VALIDATION_FAILED",
            path,
            "Only finite JSON numbers are allowed.",
            "type",
          ),
        ];
  }

  if (typeof value !== "object") {
    return [
      issue(
        "VALIDATION_FAILED",
        path,
        `Non-JSON value of type ${typeof value} is not allowed.`,
        "type",
      ),
    ];
  }

  if (ancestors.has(value)) {
    return [
      issue(
        "VALIDATION_FAILED",
        path,
        "Circular references are not valid JSON.",
        "circular",
      ),
    ];
  }
  ancestors.add(value);

  try {
    if (Array.isArray(value)) {
      const issues: ApiErrorIssue[] = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!(index in value)) {
          issues.push(
            issue(
              "VALIDATION_FAILED",
              `${path}[${index}]`,
              "Sparse arrays are not allowed.",
              "sparseArray",
            ),
          );
          continue;
        }
        issues.push(
          ...inspectJsonOnly(
            value[index],
            `${path}[${index}]`,
            depth + 1,
            ancestors,
          ),
        );
      }
      return issues;
    }

    const prototype = Object.getPrototypeOf(value) as object | null;
    if (prototype !== Object.prototype && prototype !== null) {
      return [
        issue(
          "VALIDATION_FAILED",
          path,
          "Only plain JSON objects are allowed.",
          "type",
        ),
      ];
    }

    if (Object.getOwnPropertySymbols(value).length > 0) {
      return [
        issue(
          "VALIDATION_FAILED",
          path,
          "Symbol keys are not valid JSON.",
          "symbolKey",
        ),
      ];
    }

    const descriptors = Object.getOwnPropertyDescriptors(value);
    const issues: ApiErrorIssue[] = [];
    for (const [key, descriptor] of Object.entries(descriptors)) {
      const keyPath = `${path}.${key}`;
      if (DANGEROUS_KEYS.has(key.toLowerCase())) {
        issues.push(
          issue(
            "DANGEROUS_KEY",
            keyPath,
            `Dangerous key "${key}" is not allowed.`,
            "dangerousKey",
          ),
        );
        continue;
      }
      if (isExecutableKey(key)) {
        issues.push(
          issue(
            "EXECUTABLE_PAYLOAD",
            keyPath,
            `Executable field "${key}" is not allowed.`,
            "executableField",
          ),
        );
        continue;
      }
      if ("get" in descriptor || "set" in descriptor) {
        issues.push(
          issue(
            "VALIDATION_FAILED",
            keyPath,
            "Accessor properties are not allowed.",
            "accessor",
          ),
        );
        continue;
      }
      if (!descriptor.enumerable) {
        issues.push(
          issue(
            "VALIDATION_FAILED",
            keyPath,
            "Non-enumerable properties are not valid JSON.",
            "enumerable",
          ),
        );
        continue;
      }
      issues.push(
        ...inspectJsonOnly(descriptor.value, keyPath, depth + 1, ancestors),
      );
    }
    return issues;
  } finally {
    ancestors.delete(value);
  }
}

function preflightVersion(value: unknown): ApiErrorIssue[] {
  if (!isRecord(value) || typeof value["schemaVersion"] !== "string") {
    return [];
  }
  return value["schemaVersion"] === SCHEMA_VERSION
    ? []
    : [
        issue(
          "UNKNOWN_SCHEMA_VERSION",
          "$.schemaVersion",
          `Unsupported schema version "${value["schemaVersion"]}".`,
          "const",
        ),
      ];
}

function isUtcIsoTimestamp(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) {
    return false;
  }
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

function timestampIssue(path: string, value: string): ApiErrorIssue[] {
  return isUtcIsoTimestamp(value)
    ? []
    : [
        issue(
          "INVALID_TIMESTAMP",
          path,
          "Timestamp must be a real UTC ISO-8601 value with millisecond precision.",
          "date-time",
        ),
      ];
}

function timestampMs(value: string): number {
  return new Date(value).getTime();
}

function duplicateValueIssues<T>(
  items: readonly T[],
  valueOf: (item: T) => string,
  path: string,
  propertyName: string,
): ApiErrorIssue[] {
  const seen = new Set<string>();
  const issues: ApiErrorIssue[] = [];
  items.forEach((item, index) => {
    const value = valueOf(item);
    if (seen.has(value)) {
      issues.push(
        issue(
          "DUPLICATE_ID",
          `${path}[${index}].${propertyName}`,
          `Duplicate ${propertyName} "${value}".`,
          "uniqueId",
        ),
      );
    } else {
      seen.add(value);
    }
  });
  return issues;
}

function semanticEvent(value: ContextEvent): ApiErrorIssue[] {
  const issues: ApiErrorIssue[] = [
    ...timestampIssue("$.occurredAt", value.occurredAt),
    ...timestampIssue("$.observedAt", value.observedAt),
  ];

  if (timestampMs(value.observedAt) < timestampMs(value.occurredAt)) {
    issues.push(
      issue(
        "INVALID_TIMESTAMP",
        "$.observedAt",
        "observedAt must not precede occurredAt.",
        "order",
      ),
    );
  }

  if (value.causationId === value.id) {
    issues.push(
      issue(
        "CONFLICT",
        "$.causationId",
        "An event may not cause itself.",
        "selfReference",
      ),
    );
  }

  const ttlLimit = SENSITIVITY_TTL_LIMIT_SECONDS[value.sensitivity];
  if (value.ttlSeconds > ttlLimit) {
    issues.push(
      issue(
        "SENSITIVITY_TTL_VIOLATION",
        "$.ttlSeconds",
        `${value.sensitivity} events may not exceed ${ttlLimit} seconds TTL.`,
        "maximum",
      ),
    );
  }

  const size = canonicalJsonByteLength(value);
  if (size > MAX_EVENT_BYTES) {
    issues.push(
      issue(
        "PAYLOAD_TOO_LARGE",
        "$",
        `Canonical event size ${size} bytes exceeds ${MAX_EVENT_BYTES} bytes.`,
        "maxBytes",
      ),
    );
  }
  return issues;
}

function semanticBelief(value: Belief): ApiErrorIssue[] {
  const issues: ApiErrorIssue[] = [
    ...timestampIssue("$.generatedAt", value.generatedAt),
    ...duplicateValueIssues(
      value.factors,
      (factor) => factor.id,
      "$.factors",
      "id",
    ),
    ...duplicateValueIssues(
      value.evidence,
      (evidence) => evidence.id,
      "$.evidence",
      "id",
    ),
  ];
  const generatedAt = timestampMs(value.generatedAt);
  const factorById = new Map(
    value.factors.map((factor) => [factor.id, factor] as const),
  );
  const evidenceById = new Map(
    value.evidence.map((evidence) => [evidence.id, evidence] as const),
  );
  let knownProbabilityMass = 0;

  value.factors.forEach((factor, factorIndex) => {
    const factorPath = `$.factors[${factorIndex}]`;
    issues.push(
      ...duplicateValueIssues(
        factor.probabilities,
        (probability) => probability.stateId,
        `${factorPath}.probabilities`,
        "stateId",
      ),
      ...timestampIssue(
        `${factorPath}.freshness.observedAt`,
        factor.freshness.observedAt,
      ),
      ...timestampIssue(
        `${factorPath}.freshness.expiresAt`,
        factor.freshness.expiresAt,
      ),
    );

    const knownMass = factor.probabilities.reduce(
      (sum, probability) => sum + probability.probability,
      0,
    );
    knownProbabilityMass += knownMass;
    const total = knownMass + factor.unknownProbability;
    if (Math.abs(total - 1) > PROBABILITY_NORMALIZATION_TOLERANCE) {
      issues.push(
        issue(
          "PROBABILITY_NOT_NORMALIZED",
          factorPath,
          `Probability mass ${total} is outside tolerance ${PROBABILITY_NORMALIZATION_TOLERANCE}.`,
          "probabilitySum",
        ),
      );
    }

    const freshnessObservedAt = timestampMs(factor.freshness.observedAt);
    const freshnessExpiresAt = timestampMs(factor.freshness.expiresAt);
    if (freshnessExpiresAt <= freshnessObservedAt) {
      issues.push(
        issue(
          "INVALID_TIMESTAMP",
          `${factorPath}.freshness.expiresAt`,
          "Freshness expiresAt must follow observedAt.",
          "order",
        ),
      );
    }
    if (freshnessObservedAt > generatedAt) {
      issues.push(
        issue(
          "INVALID_TIMESTAMP",
          `${factorPath}.freshness.observedAt`,
          "Freshness observedAt must not follow belief generation.",
          "order",
        ),
      );
    }

    factor.evidenceIds.forEach((evidenceId, evidenceIndex) => {
      const evidence = evidenceById.get(evidenceId);
      const evidencePath = `${factorPath}.evidenceIds[${evidenceIndex}]`;
      if (evidence === undefined) {
        issues.push(
          issue(
            "REFERENCE_NOT_FOUND",
            evidencePath,
            `Evidence "${evidenceId}" does not exist.`,
            "reference",
          ),
        );
      } else if (evidence.factorId !== factor.id) {
        issues.push(
          issue(
            "CONFLICT",
            evidencePath,
            `Evidence "${evidenceId}" belongs to factor "${evidence.factorId}".`,
            "referenceScope",
          ),
        );
      }
    });
  });

  if (
    value.status === "KNOWN" &&
    knownProbabilityMass <= PROBABILITY_NORMALIZATION_TOLERANCE
  ) {
    issues.push(
      issue(
        "CONFLICT",
        "$.status",
        "KNOWN beliefs require non-zero probability mass on at least one known state.",
        "statusConsistency",
      ),
    );
  }

  value.evidence.forEach((evidence, index) => {
    const evidencePath = `$.evidence[${index}]`;
    issues.push(
      ...timestampIssue(`${evidencePath}.observedAt`, evidence.observedAt),
    );
    if (timestampMs(evidence.observedAt) > generatedAt) {
      issues.push(
        issue(
          "INVALID_TIMESTAMP",
          `${evidencePath}.observedAt`,
          "Evidence observedAt must not follow belief generation.",
          "order",
        ),
      );
    }

    const factor = factorById.get(evidence.factorId);
    if (factor === undefined) {
      issues.push(
        issue(
          "REFERENCE_NOT_FOUND",
          `${evidencePath}.factorId`,
          `Factor "${evidence.factorId}" does not exist.`,
          "reference",
        ),
      );
    } else if (!factor.evidenceIds.includes(evidence.id)) {
      issues.push(
        issue(
          "CONFLICT",
          `${evidencePath}.id`,
          `Evidence "${evidence.id}" is not referenced by factor "${evidence.factorId}".`,
          "bidirectionalReference",
        ),
      );
    }
  });

  return issues;
}

function semanticDecision(value: Decision): ApiErrorIssue[] {
  const issues: ApiErrorIssue[] = [
    ...timestampIssue("$.createdAt", value.createdAt),
    ...duplicateValueIssues(
      value.rationale,
      (item) => item.factorId,
      "$.rationale",
      "factorId",
    ),
  ];
  if (value.decisionType === "REQUEST_CONFIRMATION") {
    issues.push(...timestampIssue("$.expiresAt", value.expiresAt));
    if (timestampMs(value.expiresAt) <= timestampMs(value.createdAt)) {
      issues.push(
        issue(
          "INVALID_TIMESTAMP",
          "$.expiresAt",
          "Confirmation expiry must follow creation.",
          "order",
        ),
      );
    }
  }
  return issues;
}

function semanticEffect(value: Effect): ApiErrorIssue[] {
  const issues: ApiErrorIssue[] = [
    ...timestampIssue("$.createdAt", value.createdAt),
    ...timestampIssue("$.updatedAt", value.updatedAt),
  ];
  const createdAt = timestampMs(value.createdAt);
  const updatedAt = timestampMs(value.updatedAt);
  if (updatedAt < createdAt) {
    issues.push(
      issue(
        "INVALID_TIMESTAMP",
        "$.updatedAt",
        "updatedAt must not precede createdAt.",
        "order",
      ),
    );
  }

  if (
    value.status === "APPLIED" ||
    value.status === "REVERTED" ||
    value.status === "FAILED"
  ) {
    if (value.appliedAt !== undefined) {
      issues.push(...timestampIssue("$.appliedAt", value.appliedAt));
      const appliedAt = timestampMs(value.appliedAt);
      if (appliedAt < createdAt || appliedAt > updatedAt) {
        issues.push(
          issue(
            "INVALID_TIMESTAMP",
            "$.appliedAt",
            "appliedAt must be between createdAt and updatedAt.",
            "order",
          ),
        );
      }
    }
  }

  if (value.status === "REVERTED") {
    issues.push(...timestampIssue("$.revertedAt", value.revertedAt));
    const revertedAt = timestampMs(value.revertedAt);
    if (revertedAt < timestampMs(value.appliedAt) || revertedAt > updatedAt) {
      issues.push(
        issue(
          "INVALID_TIMESTAMP",
          "$.revertedAt",
          "revertedAt must be between appliedAt and updatedAt.",
          "order",
        ),
      );
    }
  }
  return issues;
}

function semanticSettingsDocument(
  value: SettingsDocument,
  path = "$.document",
): ApiErrorIssue[] {
  const issues: ApiErrorIssue[] = [
    ...duplicateValueIssues(
      value.dashboard.components,
      (component) => component.id,
      `${path}.dashboard.components`,
      "id",
    ),
    ...duplicateValueIssues(
      value.audio.profiles,
      (profile) => profile.id,
      `${path}.audio.profiles`,
      "id",
    ),
  ];

  value.dashboard.components.forEach(
    (component: DashboardComponent, componentIndex) => {
      if (component.type === "metrics.grid") {
        issues.push(
          ...duplicateValueIssues(
            component.props.metrics,
            (metric) => metric.id,
            `${path}.dashboard.components[${componentIndex}].props.metrics`,
            "id",
          ),
        );
      }
    },
  );

  if (
    value.decisionPolicy.confirmationThreshold <
    value.decisionPolicy.minimumDecisionConfidence
  ) {
    issues.push(
      issue(
        "CONFLICT",
        `${path}.decisionPolicy.confirmationThreshold`,
        "confirmationThreshold must be greater than or equal to minimumDecisionConfidence.",
        "policyOrder",
      ),
    );
  }

  if (value.audio.enabled && value.audio.profiles.length === 0) {
    issues.push(
      issue(
        "REFERENCE_NOT_FOUND",
        `${path}.audio.profiles`,
        "Enabled audio requires at least one local profile.",
        "requiredByState",
      ),
    );
  }
  if (value.audio.enabled && value.audio.defaultProfileId === undefined) {
    issues.push(
      issue(
        "REFERENCE_NOT_FOUND",
        `${path}.audio.defaultProfileId`,
        "Enabled audio requires a defaultProfileId.",
        "requiredByState",
      ),
    );
  }

  value.audio.profiles.forEach((profile, index) => {
    if (profile.volume > value.audio.maxVolume) {
      issues.push(
        issue(
          "CONFLICT",
          `${path}.audio.profiles[${index}].volume`,
          `Profile volume ${profile.volume} exceeds maxVolume ${value.audio.maxVolume}.`,
          "maximumByPolicy",
        ),
      );
    }
  });

  if (value.audio.defaultProfileId !== undefined) {
    const found = value.audio.profiles.some(
      (profile) => profile.id === value.audio.defaultProfileId,
    );
    if (!found) {
      issues.push(
        issue(
          "REFERENCE_NOT_FOUND",
          `${path}.audio.defaultProfileId`,
          `Default profile "${value.audio.defaultProfileId}" does not exist.`,
          "reference",
        ),
      );
    }
  }
  return issues;
}

function checksumIssue(
  path: string,
  checksum: string,
  document: SettingsDocument,
): ApiErrorIssue[] {
  const expected = hashCanonicalJson(document);
  return checksum === expected
    ? []
    : [
        issue(
          "CHECKSUM_MISMATCH",
          path,
          `Checksum does not match canonical settings document (${expected}).`,
          "checksum",
        ),
      ];
}

function semanticSettingsDraft(value: SettingsDraft): ApiErrorIssue[] {
  return [
    ...timestampIssue("$.createdAt", value.createdAt),
    ...timestampIssue("$.updatedAt", value.updatedAt),
    ...(timestampMs(value.updatedAt) < timestampMs(value.createdAt)
      ? [
          issue(
            "INVALID_TIMESTAMP",
            "$.updatedAt",
            "updatedAt must not precede createdAt.",
            "order",
          ),
        ]
      : []),
    ...semanticSettingsDocument(value.document),
    ...checksumIssue("$.checksum", value.checksum, value.document),
  ];
}

function semanticSettingsPreview(value: SettingsPreview): ApiErrorIssue[] {
  return [
    ...timestampIssue("$.generatedAt", value.generatedAt),
    ...semanticSettingsDocument(value.document),
    ...checksumIssue(
      "$.documentChecksum",
      value.documentChecksum,
      value.document,
    ),
  ];
}

function semanticSettingsRelease(value: SettingsRelease): ApiErrorIssue[] {
  return [
    ...timestampIssue("$.publishedAt", value.publishedAt),
    ...semanticSettingsDocument(value.document),
    ...checksumIssue("$.checksum", value.checksum, value.document),
  ];
}

function semanticSettingsHistory(value: SettingsHistory): ApiErrorIssue[] {
  const issues = duplicateValueIssues(
    value.entries,
    (entry) => entry.id,
    "$.entries",
    "id",
  );
  const publishedReleaseIds = new Set<string>();
  let activeReleaseId: string | null = null;
  let previousOccurredAt = Number.NEGATIVE_INFINITY;

  value.entries.forEach((entry, index) => {
    const entryPath = `$.entries[${index}]`;
    issues.push(...timestampIssue(`${entryPath}.occurredAt`, entry.occurredAt));
    const occurredAt = timestampMs(entry.occurredAt);
    if (occurredAt < previousOccurredAt) {
      issues.push(
        issue(
          "INVALID_TIMESTAMP",
          `${entryPath}.occurredAt`,
          "History entries must be ordered by occurredAt.",
          "order",
        ),
      );
    }
    previousOccurredAt = occurredAt;

    if (entry.operation === "PUBLISH") {
      if (publishedReleaseIds.has(entry.releaseId)) {
        issues.push(
          issue(
            "DUPLICATE_ID",
            `${entryPath}.releaseId`,
            `Release "${entry.releaseId}" was already published in this history.`,
            "uniqueId",
          ),
        );
      }
      publishedReleaseIds.add(entry.releaseId);
      activeReleaseId = entry.releaseId;
      return;
    }

    if (entry.fromReleaseId === entry.toReleaseId) {
      issues.push(
        issue(
          "CONFLICT",
          `${entryPath}.toReleaseId`,
          "Rollback target must differ from rollback source.",
          "transition",
        ),
      );
    }
    if (activeReleaseId !== entry.fromReleaseId) {
      issues.push(
        issue(
          "CONFLICT",
          `${entryPath}.fromReleaseId`,
          `Rollback source "${entry.fromReleaseId}" is not the active release.`,
          "transition",
        ),
      );
    }
    if (!publishedReleaseIds.has(entry.toReleaseId)) {
      issues.push(
        issue(
          "REFERENCE_NOT_FOUND",
          `${entryPath}.toReleaseId`,
          `Rollback target "${entry.toReleaseId}" was not previously published.`,
          "reference",
        ),
      );
    }
    activeReleaseId = entry.toReleaseId;
  });

  if (value.currentReleaseId !== activeReleaseId) {
    issues.push(
      issue(
        "CONFLICT",
        "$.currentReleaseId",
        `currentReleaseId must equal the final active release (${activeReleaseId ?? "null"}).`,
        "historyState",
      ),
    );
  }
  return issues;
}

function decodeJsonPointerToken(token: string): string {
  return token.replaceAll("~1", "/").replaceAll("~0", "~");
}

function instancePathToContractPath(instancePath: string): string {
  if (instancePath === "") {
    return "$";
  }
  return instancePath
    .split("/")
    .slice(1)
    .map(decodeJsonPointerToken)
    .reduce(
      (path, token) =>
        /^\d+$/u.test(token) ? `${path}[${token}]` : `${path}.${token}`,
      "$",
    );
}

function parameterString(error: ErrorObject, key: string): string | undefined {
  const value = (error.params as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

function mapAjvError(error: ErrorObject): ApiErrorIssue {
  let path = instancePathToContractPath(error.instancePath);
  const missingProperty = parameterString(error, "missingProperty");
  const additionalProperty = parameterString(error, "additionalProperty");
  if (missingProperty !== undefined) {
    path = `${path}.${missingProperty}`;
  } else if (additionalProperty !== undefined) {
    path = `${path}.${additionalProperty}`;
  }

  const finalProperty = path
    .split(".")
    .at(-1)
    ?.replace(/\[\d+\]$/u, "");
  let code: ApiErrorCode = "VALIDATION_FAILED";
  if (path === "$.ttlSeconds") {
    code = "TTL_OUT_OF_RANGE";
  } else if (
    finalProperty !== undefined &&
    TIMESTAMP_PROPERTY_NAMES.has(finalProperty) &&
    (error.keyword === "format" ||
      error.keyword === "pattern" ||
      error.keyword === "minLength" ||
      error.keyword === "maxLength")
  ) {
    code = "INVALID_TIMESTAMP";
  }

  return issue(
    code,
    path,
    error.message === undefined ? "Schema validation failed." : error.message,
    error.keyword,
  );
}

function primaryCode(issues: readonly ApiErrorIssue[]): ApiErrorCode {
  const priority: readonly ApiErrorCode[] = [
    "UNKNOWN_SCHEMA_VERSION",
    "DANGEROUS_KEY",
    "EXECUTABLE_PAYLOAD",
    "PAYLOAD_TOO_LARGE",
    "TTL_OUT_OF_RANGE",
    "SENSITIVITY_TTL_VIOLATION",
    "PROBABILITY_NOT_NORMALIZED",
    "DUPLICATE_ID",
    "CHECKSUM_MISMATCH",
    "REFERENCE_NOT_FOUND",
    "INVALID_TIMESTAMP",
    "CONFLICT",
    "VALIDATION_FAILED",
  ];
  return (
    priority.find((code) => issues.some((item) => item.code === code)) ??
    "VALIDATION_FAILED"
  );
}

export interface ContractValidator<T> {
  validate(input: unknown): ValidationResult<T>;
  assert(input: unknown): T;
}

export function createContractValidator<TSchemaValue extends TSchema>(
  schema: TSchemaValue,
  semanticValidate: (value: Static<TSchemaValue>) => ApiErrorIssue[] = () => [],
): ContractValidator<Static<TSchemaValue>> {
  const ajv = new Ajv({
    allErrors: true,
    strict: true,
    removeAdditional: false,
    coerceTypes: false,
    useDefaults: false,
    validateFormats: true,
  });
  addFormats(ajv);
  const validateSchema: ValidateFunction<Static<TSchemaValue>> =
    ajv.compile<Static<TSchemaValue>>(schema);

  function validate(input: unknown): ValidationResult<Static<TSchemaValue>> {
    const preflightIssues = [
      ...preflightVersion(input),
      ...inspectJsonOnly(input),
    ];
    if (preflightIssues.length > 0) {
      return {
        ok: false,
        error: new ContractValidationError(
          primaryCode(preflightIssues),
          "Contract validation failed.",
          {
            issues: preflightIssues.slice(0, MAX_ISSUES),
          },
        ),
      };
    }

    if (!validateSchema(input)) {
      const schemaIssues = (validateSchema.errors ?? [])
        .map(mapAjvError)
        .slice(0, MAX_ISSUES);
      return {
        ok: false,
        error: new ContractValidationError(
          primaryCode(schemaIssues),
          "Contract validation failed.",
          {
            issues: schemaIssues,
          },
        ),
      };
    }

    const semanticIssues = semanticValidate(input);
    if (semanticIssues.length > 0) {
      return {
        ok: false,
        error: new ContractValidationError(
          primaryCode(semanticIssues),
          "Contract validation failed.",
          {
            issues: semanticIssues.slice(0, MAX_ISSUES),
          },
        ),
      };
    }
    return { ok: true, value: input };
  }

  return {
    validate,
    assert(input: unknown): Static<TSchemaValue> {
      const result = validate(input);
      if (!result.ok) {
        throw result.error;
      }
      return result.value;
    },
  };
}

export const contextEventValidator = createContractValidator(
  ContextEventSchema,
  semanticEvent,
);
export const beliefValidator = createContractValidator(
  BeliefSchema,
  semanticBelief,
);
export const decisionValidator = createContractValidator(
  DecisionSchema,
  semanticDecision,
);
export const effectValidator = createContractValidator(
  EffectSchema,
  semanticEffect,
);
export const settingsDraftValidator = createContractValidator(
  SettingsDraftSchema,
  semanticSettingsDraft,
);
export const settingsPreviewValidator = createContractValidator(
  SettingsPreviewSchema,
  semanticSettingsPreview,
);
export const settingsReleaseValidator = createContractValidator(
  SettingsReleaseSchema,
  semanticSettingsRelease,
);
export const settingsHistoryValidator = createContractValidator(
  SettingsHistorySchema,
  semanticSettingsHistory,
);
export const apiErrorEnvelopeValidator = createContractValidator(
  ApiErrorEnvelopeSchema,
);
export const jsonApiEnvelopeValidator = createContractValidator(
  JsonApiEnvelopeSchema,
);

export const validateContextEvent = (input: unknown) =>
  contextEventValidator.validate(input);
export const validateBelief = (input: unknown) =>
  beliefValidator.validate(input);
export const validateDecision = (input: unknown) =>
  decisionValidator.validate(input);
export const validateEffect = (input: unknown) =>
  effectValidator.validate(input);
export const validateSettingsDraft = (input: unknown) =>
  settingsDraftValidator.validate(input);
export const validateSettingsPreview = (input: unknown) =>
  settingsPreviewValidator.validate(input);
export const validateSettingsRelease = (input: unknown) =>
  settingsReleaseValidator.validate(input);
export const validateSettingsHistory = (input: unknown) =>
  settingsHistoryValidator.validate(input);
export const validateApiErrorEnvelope = (input: unknown) =>
  apiErrorEnvelopeValidator.validate(input);
export const validateJsonApiEnvelope = (input: unknown) =>
  jsonApiEnvelopeValidator.validate(input);

export const assertContextEvent = (input: unknown) =>
  contextEventValidator.assert(input);
export const assertBelief = (input: unknown) => beliefValidator.assert(input);
export const assertDecision = (input: unknown) =>
  decisionValidator.assert(input);
export const assertEffect = (input: unknown) => effectValidator.assert(input);
export const assertSettingsDraft = (input: unknown) =>
  settingsDraftValidator.assert(input);
export const assertSettingsPreview = (input: unknown) =>
  settingsPreviewValidator.assert(input);
export const assertSettingsRelease = (input: unknown) =>
  settingsReleaseValidator.assert(input);
export const assertSettingsHistory = (input: unknown) =>
  settingsHistoryValidator.assert(input);
export const assertApiErrorEnvelope = (input: unknown) =>
  apiErrorEnvelopeValidator.assert(input);
export const assertJsonApiEnvelope = (input: unknown) =>
  jsonApiEnvelopeValidator.assert(input);
