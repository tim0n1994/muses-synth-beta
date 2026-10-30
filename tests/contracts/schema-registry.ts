import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";
import type { ErrorObject, ValidateFunction } from "ajv";

export const schemaNames = [
  "api-success",
  "api-error",
  "health-data",
  "event-ingest-request",
  "event-ingest-data",
  "shell-config",
  "settings-draft-data",
  "release-data",
  "action-invoke-request",
  "effect-data",
] as const;

export type SchemaName = (typeof schemaNames)[number];

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  allowUnionTypes: false,
  validateFormats: false,
});

for (const name of schemaNames) {
  const schema = JSON.parse(
    readFileSync(
      new URL(`./schemas/${name}.schema.json`, import.meta.url),
      "utf8",
    ),
  ) as Parameters<typeof ajv.addSchema>[0];
  ajv.addSchema(schema);
}

const validators = new Map<SchemaName, ValidateFunction>();
for (const name of schemaNames) {
  const validator = ajv.getSchema(`muses://contracts/${name}`);
  if (validator === undefined)
    throw new Error(`Unable to compile schema ${name}`);
  validators.set(name, validator);
}

function formatErrors(errors: ErrorObject[] | null | undefined): string {
  return (errors ?? [])
    .map(
      (error) =>
        `${error.instancePath || "/"} ${error.message ?? "schema violation"}`,
    )
    .join("; ");
}

export function assertSchema(name: SchemaName, value: unknown): void {
  const validator = validators.get(name);
  if (validator === undefined) throw new Error(`Unknown schema ${name}`);
  if (!validator(value)) {
    throw new Error(
      `${name} contract violation: ${formatErrors(validator.errors)}; value=${JSON.stringify(value)}`,
    );
  }
}
