import type { JsonValue } from "./types.js";

export const ALLOWED_COMPONENT_TYPES = [
  "state.hero",
  "belief.distribution",
  "evidence.list",
  "events.timeline",
  "decision.card",
  "audio.control",
  "metrics.grid",
  "privacy.status",
] as const;

const ALLOWED_COMPONENT_SET = new Set<string>(ALLOWED_COMPONENT_TYPES);
const EXECUTABLE_KEY =
  /^(?:on[A-Z_]|on[a-z]|dangerouslySetInnerHTML$|html$|script$|srcdoc$|code$|eval$|function$|module$|import$|dynamicImport$)/u;
const EXECUTABLE_STRING =
  /(?:<\s*script\b|javascript\s*:|data\s*:\s*text\/html|\bimport\s*\(|\beval\s*\(|\bFunction\s*\()/iu;

export interface ShellComponent {
  readonly id: string;
  readonly type: (typeof ALLOWED_COMPONENT_TYPES)[number];
  readonly props: Readonly<Record<string, JsonValue>>;
}

export interface ShellConfig {
  readonly schemaVersion: "0.1";
  readonly components: readonly ShellComponent[];
}

function scanExecutable(value: JsonValue, path: string): string[] {
  const violations: string[] = [];
  if (typeof value === "string" && EXECUTABLE_STRING.test(value))
    violations.push(path);
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      violations.push(...scanExecutable(item, `${path}[${index}]`)),
    );
  } else if (typeof value === "object" && value !== null) {
    for (const [key, nested] of Object.entries(value)) {
      if (EXECUTABLE_KEY.test(key)) violations.push(`${path}.${key}`);
      violations.push(...scanExecutable(nested, `${path}.${key}`));
    }
  }
  return violations;
}

export function validateStaticShellConfig(value: JsonValue): readonly string[] {
  const violations = scanExecutable(value, "$");
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return [...violations, "$ must be an object"];
  const components = value.components;
  if (!Array.isArray(components))
    return [...violations, "$.components must be an array"];
  if (components.length > 8)
    violations.push("$.components may contain at most 8 entries");
  const ids = new Set<string>();
  components.forEach((component, index) => {
    if (
      typeof component !== "object" ||
      component === null ||
      Array.isArray(component)
    ) {
      violations.push(`$.components[${index}] must be an object`);
      return;
    }
    const id = component.id;
    const type = component.type;
    if (typeof id !== "string" || id.length === 0)
      violations.push(`$.components[${index}].id is required`);
    else if (ids.has(id))
      violations.push(`$.components[${index}].id must be unique`);
    else ids.add(id);
    if (typeof type !== "string" || !ALLOWED_COMPONENT_SET.has(type)) {
      violations.push(`$.components[${index}].type is unknown`);
    }
  });
  return violations;
}
