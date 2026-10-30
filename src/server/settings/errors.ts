import type { ValidationIssue } from "./schema.js";

export class SettingsValidationError extends Error {
  public readonly issues: readonly ValidationIssue[];

  public constructor(issues: readonly ValidationIssue[]) {
    super("Settings document validation failed");
    this.name = "SettingsValidationError";
    this.issues = issues;
  }
}

export class SettingsConflictError extends Error {
  public readonly expected: string | number;
  public readonly actual: string | number;
  public readonly field: string;

  public constructor(
    field: string,
    expected: string | number,
    actual: string | number,
  ) {
    super(
      `Settings conflict on ${field}: expected ${expected}, actual ${actual}`,
    );
    this.name = "SettingsConflictError";
    this.field = field;
    this.expected = expected;
    this.actual = actual;
  }
}

export class SettingsNotFoundError extends Error {
  public readonly resource: string;
  public readonly id: string;

  public constructor(resource: string, id: string) {
    super(`${resource} not found: ${id}`);
    this.name = "SettingsNotFoundError";
    this.resource = resource;
    this.id = id;
  }
}

export class SettingsIntegrityError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SettingsIntegrityError";
  }
}
