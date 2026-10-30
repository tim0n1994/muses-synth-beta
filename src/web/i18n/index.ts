/**
 * Public surface of the web i18n module: the catalog runtime plus the React
 * binding. Core and React live in sibling modules so the React file can
 * depend on the core without a cycle.
 */
export * from "./core";
export { I18nProvider, useI18n, type I18nProviderProps } from "./react";
