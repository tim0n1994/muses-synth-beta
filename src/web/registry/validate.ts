import { Ajv, type ErrorObject, type ValidateFunction } from "ajv";
import { dashboardConfigSchema } from "./schemas";
import {
  getRegistryDescriptor,
  isRegistryComponentType,
  listRegistryComponents,
} from "./registry";
import {
  REGISTRY_SCHEMA_VERSION,
  type DashboardConfigInput,
  type DashboardValidationResult,
  type RegistryCapability,
  type RegistryComponentType,
  type ValidatedDashboardConfig,
  type ValidatedDashboardSection,
  type ValidationIssue,
  validatedDashboardBrand,
} from "./types";

const ajv = new Ajv({ allErrors: true, strict: true });
const dashboardValidator = ajv.compile<DashboardConfigInput>(
  dashboardConfigSchema,
);

const componentValidators = new Map<
  RegistryComponentType,
  ValidateFunction<unknown>
>(
  listRegistryComponents().map((type) => {
    const descriptor = getRegistryDescriptor(type);
    return [type, ajv.compile<unknown>(descriptor.schema)] as const;
  }),
);

function ajvIssues(
  errors: readonly ErrorObject[] | null | undefined,
): readonly ValidationIssue[] {
  if (errors === null || errors === undefined || errors.length === 0) {
    return [
      {
        path: "/",
        reason: "dashboard.invalid",
        message: "Configuration failed structural validation.",
      },
    ];
  }

  return errors.map((error) => ({
    path: error.instancePath === "" ? "/" : error.instancePath,
    reason: "dashboard.invalid" as const,
    message: error.message ?? "Configuration failed structural validation.",
  }));
}

function missingCapabilities(
  required: readonly RegistryCapability[],
  available: ReadonlySet<RegistryCapability>,
): readonly RegistryCapability[] {
  return required.filter((capability) => !available.has(capability));
}

export function validateDashboardConfig(
  input: unknown,
  availableCapabilities: ReadonlySet<RegistryCapability>,
): DashboardValidationResult {
  if (!dashboardValidator(input)) {
    return {
      ok: false,
      reason: "dashboard.invalid",
      issues: ajvIssues(dashboardValidator.errors),
    };
  }

  if (input.schemaVersion !== REGISTRY_SCHEMA_VERSION) {
    return {
      ok: false,
      reason: "dashboard.schema-version",
      issues: [
        {
          path: "/schemaVersion",
          reason: "dashboard.schema-version",
          message: `Unsupported dashboard schema version: ${input.schemaVersion}`,
        },
      ],
    };
  }

  const issues: ValidationIssue[] = [];
  const sections: ValidatedDashboardSection[] = input.sections.map(
    (section, index) => {
      const path = `/sections/${index}`;

      if (!isRegistryComponentType(section.type)) {
        issues.push({
          path: `${path}/type`,
          reason: "component.unknown-type",
          message: `Unknown component type: ${section.type}`,
        });
        return {
          kind: "fallback",
          id: section.id,
          requestedType: section.type,
          reason: "component.unknown-type",
          layout: section.layout,
        };
      }

      const descriptor = getRegistryDescriptor(section.type);
      if (section.schemaVersion !== descriptor.schemaVersion) {
        issues.push({
          path: `${path}/schemaVersion`,
          reason: "component.schema-version",
          message: `Unsupported ${section.type} schema version: ${section.schemaVersion}`,
        });
        return {
          kind: "fallback",
          id: section.id,
          requestedType: section.type,
          reason: "component.schema-version",
          layout: section.layout,
        };
      }

      const missing = missingCapabilities(
        descriptor.requiredCapabilities,
        availableCapabilities,
      );
      if (missing.length > 0) {
        issues.push({
          path,
          reason: "component.missing-capability",
          message: `Missing capabilities: ${missing.join(", ")}`,
        });
        return {
          kind: "fallback",
          id: section.id,
          requestedType: section.type,
          reason: "component.missing-capability",
          layout: section.layout,
        };
      }

      const validator = componentValidators.get(section.type);
      if (validator === undefined || !validator(section.props)) {
        const detail =
          validator?.errors
            ?.map((error) => error.instancePath || "/")
            .join(", ") ?? "/";
        issues.push({
          path: `${path}/props`,
          reason: "component.invalid-props",
          message: `Invalid props at: ${detail}`,
        });
        return {
          kind: "fallback",
          id: section.id,
          requestedType: section.type,
          reason: "component.invalid-props",
          layout: section.layout,
        };
      }

      return {
        kind: "renderable",
        id: section.id,
        descriptor,
        props: section.props,
        layout: section.layout,
      };
    },
  );

  const value: ValidatedDashboardConfig = {
    [validatedDashboardBrand]: true,
    schemaVersion: REGISTRY_SCHEMA_VERSION,
    dashboardId: input.dashboardId,
    ...(input.title === undefined ? {} : { title: input.title }),
    sections,
    issues,
  };

  return { ok: true, value };
}
