import type { FieldPath, UseFormReturn } from "react-hook-form";

import type { SettingsDocument } from "../model/document";

export type SettingsForm = UseFormReturn<SettingsDocument>;
export type SettingsPath = FieldPath<SettingsDocument>;

export interface EditorProps {
  form: SettingsForm;
}

function fieldId(path: string): string {
  return `settings-${path.replace(/\./g, "-")}`;
}

export function getErrorMessage(errors: unknown, path: string): string | null {
  let current: unknown = errors;
  for (const segment of path.split(".")) {
    if (typeof current !== "object" || current === null) {
      return null;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  if (typeof current === "object" && current !== null) {
    const message = (current as Record<string, unknown>)["message"];
    return typeof message === "string" ? message : null;
  }
  return null;
}

interface SectionCardProps {
  title: string;
  description: string;
  children: React.ReactNode;
}

export function SectionCard({
  title,
  description,
  children,
}: SectionCardProps): React.JSX.Element {
  const id = `settings-${title.toLowerCase().replace(/\s+/g, "-")}-heading`;
  return (
    <section aria-labelledby={id} className="settings-section-card">
      <div className="settings-section-heading">
        <div>
          <h2 id={id}>{title}</h2>
          <p>{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

interface CheckboxFieldProps {
  form: SettingsForm;
  path: SettingsPath;
  label: string;
  help?: string;
}

export function CheckboxField({
  form,
  path,
  label,
  help,
}: CheckboxFieldProps): React.JSX.Element {
  const error = getErrorMessage(form.formState.errors, path);
  const inputId = fieldId(path);
  const helpId = `${inputId}-help`;
  return (
    <label className="settings-checkbox-field">
      <input
        type="checkbox"
        // With help text inside the wrapper label, the computed accessible
        // name would concatenate both; the explicit aria-label keeps it
        // exactly the visible label and lets help ride aria-describedby.
        aria-label={help === undefined ? undefined : label}
        aria-invalid={error !== null}
        aria-describedby={
          error !== null ? undefined : help === undefined ? undefined : helpId
        }
        {...form.register(path)}
      />
      <span>{label}</span>
      {help === undefined ? null : <small id={helpId}>{help}</small>}
      {error === null ? null : (
        <span className="settings-field-error">{error}</span>
      )}
    </label>
  );
}

interface NumberFieldProps {
  form: SettingsForm;
  path: SettingsPath;
  label: string;
  min: number;
  max: number;
  step?: number;
  help?: string;
}

export function NumberField({
  form,
  path,
  label,
  min,
  max,
  step = 1,
  help,
}: NumberFieldProps): React.JSX.Element {
  const error = getErrorMessage(form.formState.errors, path);
  const inputId = fieldId(path);
  const errorId = `${inputId}-error`;
  const helpId = `${inputId}-help`;
  return (
    <div>
      <label htmlFor={inputId}>{label}</label>
      <input
        id={inputId}
        type="number"
        min={min}
        max={max}
        step={step}
        aria-invalid={error !== null}
        aria-describedby={
          error === null ? (help && helpId) || undefined : errorId
        }
        {...form.register(path, {
          valueAsNumber: true,
          min: { value: min, message: `Minimum is ${min}.` },
          max: { value: max, message: `Maximum is ${max}.` },
        })}
      />
      {help === undefined ? null : <small id={helpId}>{help}</small>}
      {error === null ? null : (
        <span id={errorId} className="settings-field-error">
          {error}
        </span>
      )}
    </div>
  );
}

interface TextFieldProps {
  form: SettingsForm;
  path: SettingsPath;
  label: string;
  maxLength?: number;
  placeholder?: string;
  help?: string;
}

export function TextField({
  form,
  path,
  label,
  maxLength,
  placeholder,
  help,
}: TextFieldProps): React.JSX.Element {
  const error = getErrorMessage(form.formState.errors, path);
  const inputId = fieldId(path);
  const errorId = `${inputId}-error`;
  const helpId = `${inputId}-help`;
  return (
    <div>
      <label htmlFor={inputId}>{label}</label>
      <input
        id={inputId}
        type="text"
        maxLength={maxLength}
        placeholder={placeholder}
        aria-invalid={error !== null}
        aria-describedby={
          error === null ? (help && helpId) || undefined : errorId
        }
        {...form.register(path)}
      />
      {help === undefined ? null : <small id={helpId}>{help}</small>}
      {error === null ? null : (
        <span id={errorId} className="settings-field-error">
          {error}
        </span>
      )}
    </div>
  );
}

interface SelectFieldProps {
  form: SettingsForm;
  path: SettingsPath;
  label: string;
  children: React.ReactNode;
}

export function SelectField({
  form,
  path,
  label,
  children,
}: SelectFieldProps): React.JSX.Element {
  const error = getErrorMessage(form.formState.errors, path);
  const inputId = fieldId(path);
  const errorId = `${inputId}-error`;
  return (
    <div>
      <label htmlFor={inputId}>{label}</label>
      <select
        id={inputId}
        aria-invalid={error !== null}
        aria-describedby={error === null ? undefined : errorId}
        {...form.register(path)}
      >
        {children}
      </select>
      {error === null ? null : (
        <span id={errorId} className="settings-field-error">
          {error}
        </span>
      )}
    </div>
  );
}
