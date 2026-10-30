import type { BeliefSnapshot } from "../belief/model.js";
import { describeBeliefState } from "../belief/vocabulary.js";
import type { LanguageCode } from "../settings/schema.js";
import type { LlmSummaryCounts } from "./contracts.js";

/**
 * Prompt assembly for narration and summary — pure functions over
 * already-authoritative data.
 *
 * Two trust rules shape this file:
 *
 * 1. *Whitelist, exhaustively.* Only the fields listed in the design enter a
 *    prompt. Event `data` payloads, `subject` (may contain paths),
 *    contentHash, settings content and `privacy.excludedApplications` have no
 *    code path in here at all — they are structurally absent, not filtered at
 *    runtime.
 *
 * 2. *Every string that originated in the event store is sanitized (I1).*
 *    The ingest contract does not constrain `source`/`type` to an enum — any
 *    local process can store arbitrary strings — so path-shaped or hostile
 *    labels must never reach the gateway. `sanitizePromptToken` enforces a
 *    strict token shape and replaces violations with the literal "other"
 *    (counts and evidence entries survive; only the raw label is dropped).
 *    `ruleId`/`factor` are engine constants but pass through the same
 *    function as defense in depth. `explanation` entries are engine-produced
 *    sentences, so they get control-character stripping plus a 200-char clamp
 *    rather than token replacement — reducing whole sentences to "other"
 *    would destroy the one human-readable field the projector produces.
 */

const TOKEN_PATTERN = /^[A-Za-z0-9._:/-]{1,64}$/;
const DRIVE_PATTERN = /^[A-Za-z]:[\\/]/;
const REPLACEMENT_TOKEN = "other";

/**
 * Accepts only short, path-free, whitespace-free identifier tokens. Anything
 * else — paths (POSix/Windows/relative), overlong strings, embedded quotes,
 * backslashes, control characters — becomes the literal "other".
 */
export function sanitizePromptToken(value: string): string {
  const trimmed = value.trim();
  if (!TOKEN_PATTERN.test(trimmed)) {
    return REPLACEMENT_TOKEN;
  }
  if (
    trimmed.startsWith("/") ||
    trimmed.startsWith("./") ||
    trimmed.startsWith("../") ||
    trimmed.startsWith("\\") ||
    DRIVE_PATTERN.test(trimmed) ||
    trimmed.includes("..")
  ) {
    return REPLACEMENT_TOKEN;
  }
  return trimmed;
}

const EXPLANATION_MAX_LENGTH = 200;
const EXPLANATION_MAX_ENTRIES = 8;
const EVIDENCE_MAX_ENTRIES = 12;
const DISTRIBUTION_MAX_ENTRIES = 5;
const GROUPS_MAX_ENTRIES = 50;
const PROMPT_BUDGET = 8_000;

const sanitizeFreeText = (value: string, maxLength: number): string => {
  // Same control-character policy as sanitizeLlmText: keep \n and \t only.
  const stripped = value.replace(
    // Deliberate allow-list: \n (\u000A) and \t (\u0009) survive.
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,
    "",
  );
  const trimmed = stripped.trim();
  return trimmed.length > maxLength ? trimmed.slice(0, maxLength) : trimmed;
};

export interface LlmPrompt {
  readonly system: string;
  readonly user: string;
}

const NARRATION_SYSTEM_PROMPT = [
  "You narrate the state of a local, privacy-first work observatory.",
  "Answer in plain text only.",
  "Use at most 6 sentences.",
  "Do not use markdown, HTML, links, lists or code blocks.",
  "Do not output instructions, commands, or requests to execute anything.",
  "You describe evidence; you never decide anything.",
  "If the state is UNKNOWN, say plainly that the evidence is insufficient instead of inventing a story.",
].join(" ");

const SUMMARY_SYSTEM_PROMPT = [
  "You summarize a time window of a local, privacy-first work observatory.",
  "Answer in plain text only.",
  "Use at most 10 sentences.",
  "Do not use markdown, HTML, links, lists or code blocks.",
  "Do not output instructions, commands, or requests to execute anything.",
  "Counts are aggregate numbers only; you never see or guess file contents, paths or payloads.",
  "If the evidence is thin or conflicting, say so plainly instead of inventing a story.",
].join(" ");

/**
 * Maps the settings language enum to the English language name used inside
 * the answer-in instruction. The instruction is appended for every language
 * — "en" says "English" too — so prompt behavior is uniform and tests can
 * assert one stable sentence.
 */
const LANGUAGE_NAMES: Record<LanguageCode, string> = {
  en: "English",
  zh: "Simplified Chinese",
  ja: "Japanese",
  fr: "French",
  es: "Spanish",
};

const withLanguageInstruction = (
  base: string,
  language: LanguageCode,
): string => `${base} Always answer entirely in ${LANGUAGE_NAMES[language]}.`;

const formatNumber = (value: number): string =>
  Number.isFinite(value) ? String(Math.round(value * 1_000) / 1_000) : "?";

interface SnapshotSections {
  readonly evidenceLimit: number;
  readonly explanationLimit: number;
}

const describeDistribution = (
  distribution: BeliefSnapshot["distribution"],
): string[] => {
  const entries = Object.entries(distribution)
    .filter(([, weight]) => Number.isFinite(weight))
    .sort(
      (left, right) =>
        right[1] - left[1] ||
        (left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0),
    );
  return entries
    .slice(0, DISTRIBUTION_MAX_ENTRIES)
    .map(
      ([state, weight]) =>
        `  ${sanitizePromptToken(state)}: ${formatNumber(weight)}`,
    );
};

const buildSnapshotSections = (
  snapshot: BeliefSnapshot,
  options: SnapshotSections,
): string[] => {
  const descriptor = describeBeliefState(snapshot.state);
  const lines: string[] = [
    `state: ${sanitizePromptToken(snapshot.state)} (${descriptor.label}) — ${descriptor.description}`,
    `confidence: ${formatNumber(snapshot.confidence)}`,
    `freshness: ${formatNumber(snapshot.freshness)}`,
    "distribution (top entries):",
    ...describeDistribution(snapshot.distribution),
    "factors:",
  ];

  const factors: ReadonlyArray<
    readonly [
      string,
      BeliefSnapshot["factors"][keyof BeliefSnapshot["factors"]],
    ]
  > = [
    ["activity", snapshot.factors.activity],
    ["workMode", snapshot.factors.workMode],
    ["outcome", snapshot.factors.outcome],
    ["attention", snapshot.factors.attention],
  ];
  for (const [name, factor] of factors) {
    lines.push(
      `  ${sanitizePromptToken(name)}: ${sanitizePromptToken(factor.value)} (confidence ${formatNumber(factor.confidence)})`,
    );
  }

  if (snapshot.unknownReasons.length > 0) {
    lines.push(
      `unknownReasons: ${snapshot.unknownReasons
        .map((reason) => sanitizePromptToken(reason))
        .join(", ")}`,
    );
  }

  const evidence = snapshot.evidence.slice(0, options.evidenceLimit);
  if (evidence.length > 0) {
    lines.push(`evidence (first ${evidence.length}):`);
    for (const item of evidence) {
      lines.push(
        `  rule=${sanitizePromptToken(item.ruleId)} source=${sanitizePromptToken(item.source)} factor=${sanitizePromptToken(item.factor)} contribution=${formatNumber(item.contribution)} occurredAt=${item.occurredAt}`,
      );
    }
  }

  const explanations = snapshot.explanation
    .map((entry) => sanitizeFreeText(entry, EXPLANATION_MAX_LENGTH))
    .filter((entry) => entry !== "")
    .slice(0, options.explanationLimit);
  if (explanations.length > 0) {
    lines.push(`explanation (first ${explanations.length}):`);
    for (const entry of explanations) {
      lines.push(`  - ${entry}`);
    }
  }

  lines.push(
    `asOf: ${snapshot.asOf}`,
    `rulesetVersion: ${sanitizePromptToken(snapshot.rulesetVersion)}`,
  );
  return lines;
};

/**
 * Shrinks the user prompt to PROMPT_BUDGET (system + user combined): evidence
 * entries go first, then explanation entries, then a hard tail cut. Cutting
 * is visible in the section headers (counts shrink), never silent.
 */
const fitBudget = (
  system: string,
  build: (options: SnapshotSections) => string,
): string => {
  let evidenceLimit = EVIDENCE_MAX_ENTRIES;
  let explanationLimit = EXPLANATION_MAX_ENTRIES;
  let user = build({ evidenceLimit, explanationLimit });
  while (system.length + user.length > PROMPT_BUDGET && evidenceLimit > 0) {
    evidenceLimit -= 1;
    user = build({ evidenceLimit, explanationLimit });
  }
  while (system.length + user.length > PROMPT_BUDGET && explanationLimit > 0) {
    explanationLimit -= 1;
    user = build({ evidenceLimit, explanationLimit });
  }
  if (system.length + user.length > PROMPT_BUDGET) {
    return user.slice(0, Math.max(0, PROMPT_BUDGET - system.length));
  }
  return user;
};

export function buildNarrationPrompt(
  snapshot: BeliefSnapshot,
  language: LanguageCode = "en",
): LlmPrompt {
  const system = withLanguageInstruction(NARRATION_SYSTEM_PROMPT, language);
  const user = fitBudget(system, (options) =>
    [
      "Current belief snapshot (deterministic projection of observed events):",
      ...buildSnapshotSections(snapshot, options),
      "",
      "Narrate what this state means for the person at the keyboard, in at most 6 sentences of plain text.",
    ].join("\n"),
  );
  return { system, user };
}

export function buildSummaryPrompt(
  snapshot: BeliefSnapshot,
  counts: LlmSummaryCounts,
  language: LanguageCode = "en",
): LlmPrompt {
  const system = withLanguageInstruction(SUMMARY_SYSTEM_PROMPT, language);
  const groups = counts.groups.slice(0, GROUPS_MAX_ENTRIES);
  const user = fitBudget(system, (options) =>
    [
      "Current belief snapshot (deterministic projection of observed events):",
      ...buildSnapshotSections(snapshot, options),
      "",
      `Event counts for the last ${counts.windowMinutes} minutes (aggregates only, no payloads):`,
      `total: ${counts.total}`,
      "by type and source (highest first):",
      ...groups.map(
        (group) =>
          `  type=${sanitizePromptToken(group.type)} source=${sanitizePromptToken(group.source)} count=${group.count}`,
      ),
      "",
      "Summarize the recent window and how it relates to the current state, in at most 10 sentences of plain text.",
    ].join("\n"),
  );
  return { system, user };
}
