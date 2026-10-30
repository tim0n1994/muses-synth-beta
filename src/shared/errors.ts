import { SCHEMA_VERSION } from "./constants";
import type {
  ApiErrorBody,
  ApiErrorCode,
  ApiErrorEnvelope,
  ApiErrorIssue,
} from "./schemas/api";

const MAX_ERROR_MESSAGE_LENGTH = 280;
const MAX_ERROR_ISSUES = 64;
const MAX_ISSUE_PATH_LENGTH = 256;
const MAX_ISSUE_KEYWORD_LENGTH = 64;

function safeText(value: string, maximum: number): string {
  const sanitized = value.replace(/[\u0000-\u001F\u007F]/gu, " ");
  return sanitized.length <= maximum
    ? sanitized
    : `${sanitized.slice(0, Math.max(0, maximum - 1))}…`;
}

function safeIssue(value: ApiErrorIssue): ApiErrorIssue {
  const issue: ApiErrorIssue = {
    code: value.code,
    path: safeText(value.path, MAX_ISSUE_PATH_LENGTH),
    message: safeText(value.message, MAX_ERROR_MESSAGE_LENGTH),
  };
  if (value.keyword !== undefined) {
    issue.keyword = safeText(value.keyword, MAX_ISSUE_KEYWORD_LENGTH);
  }
  return issue;
}

export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ContractValidationError };

export class ContractValidationError extends Error {
  public readonly code: ApiErrorCode;
  public readonly status: number;
  public readonly retryable: boolean;
  public readonly issues: readonly ApiErrorIssue[];

  public constructor(
    code: ApiErrorCode,
    message: string,
    options: {
      readonly status?: number;
      readonly retryable?: boolean;
      readonly issues?: readonly ApiErrorIssue[];
    } = {},
  ) {
    super(safeText(message, MAX_ERROR_MESSAGE_LENGTH));
    this.name = "ContractValidationError";
    this.code = code;
    this.status =
      options.status !== undefined &&
      Number.isInteger(options.status) &&
      options.status >= 400 &&
      options.status <= 599
        ? options.status
        : 400;
    this.retryable = options.retryable ?? false;
    this.issues = (options.issues ?? [])
      .slice(0, MAX_ERROR_ISSUES)
      .map(safeIssue);
  }

  public toApiErrorBody(): ApiErrorBody {
    const body: ApiErrorBody = {
      code: this.code,
      message: this.message,
      status: this.status,
      retryable: this.retryable,
    };
    if (this.issues.length > 0) {
      body.issues = [...this.issues];
    }
    return body;
  }

  public toApiEnvelope(requestId: string): ApiErrorEnvelope {
    return {
      schemaVersion: SCHEMA_VERSION,
      ok: false,
      requestId,
      error: this.toApiErrorBody(),
    };
  }
}
