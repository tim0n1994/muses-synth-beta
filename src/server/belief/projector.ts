import { createHash } from "node:crypto";
import type { ContextEventRecord, JsonValue } from "../context/model.js";
import {
  BELIEF_STATES,
  type ActivityFactor,
  type AttentionFactor,
  type BeliefDistribution,
  type BeliefFactors,
  type BeliefSnapshot,
  type BeliefState,
  type EvidenceRef,
  type FactorName,
  type OutcomeFactor,
  type UnknownReason,
  type WorkModeFactor,
} from "./model.js";
import { BELIEF_RULES, BELIEF_RULESET_VERSION, RULE_IDS } from "./rules.js";
import {
  STATE_COUNT,
  createChainGeneration,
  type BeliefChainMemo,
  type ChainCheckpoints,
} from "./chain-memo.js";

interface Evaluation {
  readonly rawState: BeliefState;
  readonly distribution: BeliefDistribution;
  readonly freshness: number;
  readonly evidence: readonly EvidenceRef[];
  readonly unknownReasons: readonly UnknownReason[];
  readonly explanation: readonly string[];
  readonly facts: EvaluationFacts;
}

interface EvaluationFacts {
  readonly recognizedEvents: readonly ContextEventRecord[];
  readonly meaningfulEvents: readonly ContextEventRecord[];
  readonly editEvents: readonly ContextEventRecord[];
  readonly testEvents: readonly TestEvent[];
  readonly reviewEvents: readonly ContextEventRecord[];
  readonly latestSession?: SessionEvent;
  readonly sustainedEditing: boolean;
  readonly conflictingTests: boolean;
}

interface TestEvent {
  readonly event: ContextEventRecord;
  readonly status: "passed" | "failed" | "cancelled";
}

interface SessionEvent {
  readonly event: ContextEventRecord;
  readonly status: "active" | "idle" | "inactive";
}

interface ScoreAccumulator {
  readonly scores: Record<BeliefState, number>;
  readonly evidence: EvidenceRef[];
  readonly explanation: string[];
}

export interface ProjectBeliefOptions {
  readonly maxEvents?: number;
  /**
   * Per-stream memo of the hysteresis chain's checkpoint evaluations (see
   * chain-memo.ts). Purely a cost lever: with or without it the snapshot is
   * identical. The caller owns the memo and must use it for one stream only.
   */
  readonly chainMemo?: BeliefChainMemo;
}

const DEFAULT_MAX_EVENTS = 2_000;

export const projectBelief = (
  inputEvents: readonly ContextEventRecord[],
  asOfInput: string,
  options: ProjectBeliefOptions = {},
): BeliefSnapshot => {
  const asOfMs = Date.parse(asOfInput);
  if (!Number.isFinite(asOfMs)) {
    throw new Error("Belief projection asOf must be a valid timestamp.");
  }
  const asOf = new Date(asOfMs).toISOString();
  const maxEvents = options.maxEvents ?? DEFAULT_MAX_EVENTS;
  if (
    !Number.isSafeInteger(maxEvents) ||
    maxEvents <= 0 ||
    maxEvents > 10_000
  ) {
    throw new Error(
      "Belief projection maxEvents must be an integer from 1 to 10000.",
    );
  }

  const events = normalizeEvents(inputEvents, asOfMs);
  if (events.length > maxEvents) {
    throw new Error(
      `Belief replay exceeds the configured maximum of ${maxEvents} events.`,
    );
  }

  const chain = runHysteresisChain(events, options.chainMemo);

  const finalEvaluation = evaluate(events, asOfMs);
  const hysteresis = applyHysteresis(
    finalEvaluation.rawState,
    finalEvaluation.distribution,
    chain.state,
    chain.freshness,
  );
  const state = hysteresis.state;
  const evidence = deduplicateEvidence(finalEvaluation.evidence);
  const explanation = hysteresis.retained
    ? [
        ...finalEvaluation.explanation,
        `Hysteresis retained ${state}; challenger separation was below ${BELIEF_RULES.hysteresisMargin}.`,
      ]
    : finalEvaluation.explanation;
  const factors = buildFactors(
    finalEvaluation.facts,
    state,
    finalEvaluation.distribution[state],
    asOfMs,
    evidence,
  );
  const lastServerSequence = events.reduce<number | undefined>(
    (current, event) =>
      current === undefined || event.serverSequence > current
        ? event.serverSequence
        : current,
    undefined,
  );

  return {
    state,
    confidence: round(finalEvaluation.distribution[state]),
    freshness: round(finalEvaluation.freshness),
    distribution: finalEvaluation.distribution,
    factors,
    evidence,
    unknownReasons: state === "UNKNOWN" ? finalEvaluation.unknownReasons : [],
    explanation,
    asOf,
    rulesetVersion: BELIEF_RULESET_VERSION,
    inputDigest: digestProjection(events, asOf),
    ...(lastServerSequence === undefined ? {} : { lastServerSequence }),
  };
};

const normalizeEvents = (
  inputEvents: readonly ContextEventRecord[],
  asOfMs: number,
): readonly ContextEventRecord[] => {
  const byIdentity = new Map<string, ContextEventRecord>();
  for (const event of inputEvents) {
    const occurredMs = Date.parse(event.occurredAt);
    const expiresMs = Date.parse(event.expiresAt);
    if (!Number.isFinite(occurredMs) || !Number.isFinite(expiresMs)) {
      continue;
    }
    if (occurredMs > asOfMs || expiresMs <= asOfMs) {
      continue;
    }
    const key = `${event.source}\u0000${event.id}`;
    const existing = byIdentity.get(key);
    if (existing !== undefined && existing.contentHash !== event.contentHash) {
      throw new Error(
        `Conflicting duplicate event identity: ${event.source} / ${event.id}.`,
      );
    }
    if (
      existing === undefined ||
      event.serverSequence < existing.serverSequence
    ) {
      byIdentity.set(key, event);
    }
  }
  // Decorate-sort-undecorate: the comparator used to re-parse both
  // timestamps on every comparison (~2 × n log n parses per projection).
  const ordered = [...byIdentity.values()].map((event) => ({
    event,
    occurredMs: Date.parse(event.occurredAt),
  }));
  ordered.sort((left, right) =>
    left.occurredMs === right.occurredMs
      ? left.event.serverSequence - right.event.serverSequence
      : left.occurredMs - right.occurredMs,
  );
  return ordered.map((entry) => entry.event);
};

const evaluate = (
  events: readonly ContextEventRecord[],
  asOfMs: number,
): Evaluation => {
  const accumulator = createAccumulator();
  const facts = collectFacts(events, asOfMs);
  const unknownReasons: UnknownReason[] = [];

  if (facts.meaningfulEvents.length === 0) {
    if (events.length === 0) {
      unknownReasons.push("NO_RELEVANT_EVIDENCE");
    } else if (facts.recognizedEvents.length === 0) {
      unknownReasons.push("UNRECOGNIZED_ONLY");
    } else {
      unknownReasons.push("STALE_EVIDENCE");
    }
  }

  applySetupAndExploreRules(facts, asOfMs, accumulator);
  applyEditingRules(facts, asOfMs, accumulator);
  applyTestingRules(facts, asOfMs, accumulator, unknownReasons);
  applyReviewRules(facts, asOfMs, accumulator);
  applyInactivityRules(facts, asOfMs, accumulator, unknownReasons);

  const distribution = normalizeScores(accumulator.scores);
  const rankedKnown = BELIEF_STATES.filter((state) => state !== "UNKNOWN").sort(
    (left, right) => distribution[right] - distribution[left],
  );
  const first = rankedKnown[0] ?? "UNKNOWN";
  const second = rankedKnown[1] ?? "UNKNOWN";
  const separation = distribution[first] - distribution[second];

  let rawState: BeliefState = first;
  if (unknownReasons.includes("CONFLICTING_TEST_RESULTS")) {
    rawState = "UNKNOWN";
  } else if (
    facts.meaningfulEvents.length === 0 ||
    distribution[first] < BELIEF_RULES.minimumKnownProbability ||
    separation < BELIEF_RULES.lowSeparationMargin
  ) {
    rawState = "UNKNOWN";
    if (
      facts.meaningfulEvents.length > 0 &&
      !unknownReasons.includes("STALE_EVIDENCE") &&
      !unknownReasons.includes("LOW_SEPARATION")
    ) {
      unknownReasons.push("LOW_SEPARATION");
    }
  }

  const latestMeaningful = facts.meaningfulEvents.at(-1);
  const freshness =
    latestMeaningful === undefined
      ? 0
      : freshnessForAge(
          asOfMs - Date.parse(latestMeaningful.occurredAt),
          BELIEF_RULES.evidenceWindowMs,
        );

  return {
    rawState,
    distribution,
    freshness,
    evidence: accumulator.evidence,
    unknownReasons,
    explanation:
      accumulator.explanation.length === 0
        ? [
            "No recognized, fresh evidence was strong enough to select a known state.",
          ]
        : accumulator.explanation,
    facts,
  };
};

const createAccumulator = (): ScoreAccumulator => ({
  scores: {
    SETUP: 0.05,
    EXPLORE: 0.05,
    BUILD: 0.05,
    DEBUG: 0.05,
    REVIEW: 0.05,
    WAIT: 0.05,
    BREAK: 0.05,
    UNKNOWN: 0.35,
  },
  evidence: [],
  explanation: [],
});

const collectFacts = (
  events: readonly ContextEventRecord[],
  asOfMs: number,
): EvaluationFacts => {
  const recognizedEvents: ContextEventRecord[] = [];
  const meaningfulEvents: ContextEventRecord[] = [];
  const editEvents: ContextEventRecord[] = [];
  const testEvents: TestEvent[] = [];
  const reviewEvents: ContextEventRecord[] = [];
  let latestSession: SessionEvent | undefined;

  for (const event of events) {
    const ageMs = asOfMs - Date.parse(event.occurredAt);
    if (ageMs < 0) {
      continue;
    }
    const data = asRecord(event.data);
    const recognized = isRecognizedEvent(event, data);
    if (!recognized) {
      continue;
    }
    recognizedEvents.push(event);
    if (ageMs > BELIEF_RULES.evidenceWindowMs) {
      continue;
    }

    switch (event.type) {
      case "muses.environment.setup":
      case "muses.process.activity":
        meaningfulEvents.push(event);
        break;
      case "muses.editor.activity": {
        const action = readString(data, "action");
        if (action === "edit" || action === "save") {
          editEvents.push(event);
        }
        meaningfulEvents.push(event);
        break;
      }
      case "muses.test.run.completed": {
        const status = readString(data, "status");
        if (
          status === "passed" ||
          status === "failed" ||
          status === "cancelled"
        ) {
          testEvents.push({ event, status });
          meaningfulEvents.push(event);
        }
        break;
      }
      case "muses.review.activity":
        reviewEvents.push(event);
        meaningfulEvents.push(event);
        break;
      case "muses.session.activity": {
        const status = readString(data, "status");
        if (status === "active" || status === "idle" || status === "inactive") {
          latestSession = { event, status };
          meaningfulEvents.push(event);
        }
        break;
      }
      default:
        break;
    }
  }

  const recentEdits = editEvents.filter(
    (event) =>
      asOfMs - Date.parse(event.occurredAt) <= BELIEF_RULES.editingWindowMs,
  );
  const firstEdit = recentEdits[0];
  const lastEdit = recentEdits.at(-1);
  const sustainedEditing =
    recentEdits.length >= BELIEF_RULES.editingMinimumEvents &&
    firstEdit !== undefined &&
    lastEdit !== undefined &&
    Date.parse(lastEdit.occurredAt) - Date.parse(firstEdit.occurredAt) >=
      BELIEF_RULES.editingMinimumSpanMs;

  const recentTests = testEvents.filter(
    ({ event }) =>
      asOfMs - Date.parse(event.occurredAt) <= BELIEF_RULES.testWindowMs,
  );
  const conflictingTests = hasConflictingTests(recentTests);

  return {
    recognizedEvents,
    meaningfulEvents,
    editEvents,
    testEvents,
    reviewEvents,
    ...(latestSession === undefined ? {} : { latestSession }),
    sustainedEditing,
    conflictingTests,
  };
};

const applySetupAndExploreRules = (
  facts: EvaluationFacts,
  asOfMs: number,
  accumulator: ScoreAccumulator,
): void => {
  for (const event of facts.meaningfulEvents) {
    const ageMs = asOfMs - Date.parse(event.occurredAt);
    if (event.type === "muses.environment.setup" && ageMs <= 10 * 60 * 1_000) {
      addScore(
        accumulator,
        "SETUP",
        1.5 * freshnessForAge(ageMs, 10 * 60 * 1_000),
        RULE_IDS.setup,
        event,
        "state",
      );
    }
    if (event.type === "muses.editor.activity") {
      const action = readString(asRecord(event.data), "action");
      if (
        (action === "navigate" || action === "open") &&
        ageMs <= BELIEF_RULES.activeWindowMs
      ) {
        addScore(
          accumulator,
          "EXPLORE",
          0.55 * freshnessForAge(ageMs, BELIEF_RULES.activeWindowMs),
          RULE_IDS.explore,
          event,
          "workMode",
        );
      }
    }
  }
};

const applyEditingRules = (
  facts: EvaluationFacts,
  asOfMs: number,
  accumulator: ScoreAccumulator,
): void => {
  const recentEdits = facts.editEvents.filter(
    (event) =>
      asOfMs - Date.parse(event.occurredAt) <= BELIEF_RULES.editingWindowMs,
  );
  for (const event of recentEdits) {
    const ageMs = asOfMs - Date.parse(event.occurredAt);
    addScore(
      accumulator,
      "BUILD",
      0.32 * freshnessForAge(ageMs, BELIEF_RULES.editingWindowMs),
      RULE_IDS.editPulse,
      event,
      "workMode",
    );
  }
  if (facts.sustainedEditing) {
    const contribution = 1.8 / recentEdits.length;
    for (const event of recentEdits) {
      addScore(
        accumulator,
        "BUILD",
        contribution,
        RULE_IDS.sustainedEditing,
        event,
        "attention",
      );
    }
    accumulator.explanation.push(
      `Sustained editing: ${recentEdits.length} edit/save events spanning at least ${BELIEF_RULES.editingMinimumSpanMs / 1_000} seconds.`,
    );
  }
};

const applyTestingRules = (
  facts: EvaluationFacts,
  asOfMs: number,
  accumulator: ScoreAccumulator,
  unknownReasons: UnknownReason[],
): void => {
  const recentTests = facts.testEvents.filter(
    ({ event }) =>
      asOfMs - Date.parse(event.occurredAt) <= BELIEF_RULES.testWindowMs,
  );
  const latest = recentTests.at(-1);
  const passed = recentTests.filter((test) => test.status === "passed");
  const failed = recentTests.filter((test) => test.status === "failed");

  if (latest?.status === "failed") {
    addScore(
      accumulator,
      "DEBUG",
      3.8,
      RULE_IDS.failingTest,
      latest.event,
      "outcome",
    );
    accumulator.explanation.push(
      "The latest fresh test run failed, selecting a conservative debug hypothesis.",
    );
    if (failed.length >= 2) {
      const lastTwo = failed.slice(-2);
      for (const test of lastTwo) {
        addScore(
          accumulator,
          "DEBUG",
          0.4,
          RULE_IDS.repeatedFailure,
          test.event,
          "outcome",
        );
      }
      accumulator.explanation.push(
        "At least two fresh failing test runs reinforce DEBUG.",
      );
    }
  }

  if (latest?.status === "passed") {
    addScore(
      accumulator,
      "BUILD",
      0.8,
      RULE_IDS.successfulTest,
      latest.event,
      "outcome",
    );
    addScore(
      accumulator,
      "REVIEW",
      0.25,
      RULE_IDS.successfulTest,
      latest.event,
      "outcome",
    );
    accumulator.explanation.push("The latest fresh test run passed.");
  }

  if (passed.length >= 2 && facts.sustainedEditing) {
    for (const test of passed.slice(-2)) {
      addScore(
        accumulator,
        "BUILD",
        0.6,
        RULE_IDS.sustainedSuccess,
        test.event,
        "outcome",
      );
    }
    accumulator.explanation.push(
      "Sustained editing plus repeated successful tests reinforces BUILD.",
    );
  }

  if (
    latest?.status === "passed" &&
    failed.some(
      (test) =>
        Date.parse(test.event.occurredAt) < Date.parse(latest.event.occurredAt),
    )
  ) {
    addScore(
      accumulator,
      "REVIEW",
      1.0,
      RULE_IDS.recoveredFailure,
      latest.event,
      "outcome",
    );
    accumulator.explanation.push(
      "A passing test after a failure raises REVIEW as the next likely activity.",
    );
  }

  if (facts.conflictingTests) {
    const conflictEvents = recentTests.slice(-2);
    for (const test of conflictEvents) {
      addScore(
        accumulator,
        "UNKNOWN",
        1.25,
        RULE_IDS.testConflict,
        test.event,
        "outcome",
      );
    }
    unknownReasons.push("CONFLICTING_TEST_RESULTS");
    accumulator.explanation.push(
      `Passed and failed test evidence occurred within ${BELIEF_RULES.conflictWindowMs / 1_000} seconds; state is UNKNOWN until separated by newer evidence.`,
    );
  }
};

const applyReviewRules = (
  facts: EvaluationFacts,
  asOfMs: number,
  accumulator: ScoreAccumulator,
): void => {
  const recentReview = facts.reviewEvents.filter(
    (event) =>
      asOfMs - Date.parse(event.occurredAt) <= BELIEF_RULES.reviewWindowMs,
  );
  for (const event of recentReview) {
    const ageMs = asOfMs - Date.parse(event.occurredAt);
    addScore(
      accumulator,
      "REVIEW",
      1.8 * freshnessForAge(ageMs, BELIEF_RULES.reviewWindowMs),
      RULE_IDS.review,
      event,
      "workMode",
    );
  }
  if (recentReview.length > 0) {
    accumulator.explanation.push(
      "Fresh diff, commit, or review activity supports REVIEW.",
    );
  }
};

const applyInactivityRules = (
  facts: EvaluationFacts,
  asOfMs: number,
  accumulator: ScoreAccumulator,
  unknownReasons: UnknownReason[],
): void => {
  const session = facts.latestSession;
  if (session !== undefined) {
    const ageMs = asOfMs - Date.parse(session.event.occurredAt);
    if (ageMs <= BELIEF_RULES.activeWindowMs && session.status === "idle") {
      addScore(
        accumulator,
        "WAIT",
        2.2,
        RULE_IDS.explicitIdle,
        session.event,
        "activity",
      );
      accumulator.explanation.push(
        "A fresh explicit idle signal supports WAIT.",
      );
      return;
    }
    if (ageMs <= BELIEF_RULES.activeWindowMs && session.status === "inactive") {
      addScore(
        accumulator,
        "BREAK",
        3.0,
        RULE_IDS.explicitInactive,
        session.event,
        "activity",
      );
      accumulator.explanation.push(
        "A fresh explicit inactive signal supports BREAK.",
      );
      return;
    }
  }

  const latest = facts.meaningfulEvents.at(-1) ?? facts.recognizedEvents.at(-1);
  if (latest === undefined) {
    return;
  }
  const ageMs = asOfMs - Date.parse(latest.occurredAt);
  if (ageMs > BELIEF_RULES.evidenceWindowMs) {
    addScore(accumulator, "UNKNOWN", 3.0, RULE_IDS.stale, latest, "activity");
    if (!unknownReasons.includes("STALE_EVIDENCE")) {
      unknownReasons.push("STALE_EVIDENCE");
    }
    accumulator.explanation.push(
      "All recognized evidence is stale; UNKNOWN is selected.",
    );
  } else if (ageMs > BELIEF_RULES.waitWindowMs) {
    addScore(
      accumulator,
      "BREAK",
      2.5,
      RULE_IDS.inactivityBreak,
      latest,
      "activity",
    );
    accumulator.explanation.push(
      "No recognized activity for more than 15 minutes supports BREAK.",
    );
  } else if (ageMs > BELIEF_RULES.activeWindowMs) {
    addScore(
      accumulator,
      "WAIT",
      1.8,
      RULE_IDS.inactivityWait,
      latest,
      "activity",
    );
    accumulator.explanation.push(
      "No recognized activity for more than 5 minutes supports WAIT.",
    );
  }

  for (const event of facts.meaningfulEvents) {
    if (event.type !== "muses.process.activity") {
      continue;
    }
    const status = readString(asRecord(event.data), "status");
    const eventAgeMs = asOfMs - Date.parse(event.occurredAt);
    if (status === "waiting" && eventAgeMs <= BELIEF_RULES.waitWindowMs) {
      addScore(
        accumulator,
        "WAIT",
        1.5,
        RULE_IDS.processWaiting,
        event,
        "workMode",
      );
    }
  }
};

const applyHysteresis = (
  rawState: BeliefState,
  distribution: BeliefDistribution,
  previousState: BeliefState,
  previousFreshness: number,
): Readonly<{ state: BeliefState; retained: boolean }> => {
  if (
    rawState === "UNKNOWN" ||
    previousState === "UNKNOWN" ||
    rawState === previousState
  ) {
    return { state: rawState, retained: false };
  }
  const shouldRetain = retainsIncumbent(
    distribution[rawState],
    distribution[previousState],
    previousFreshness,
  );
  return shouldRetain
    ? { state: previousState, retained: true }
    : { state: rawState, retained: false };
};

/** The hysteresis decision proper: a fresh-enough incumbent survives a challenger that leads by less than the margin. */
const retainsIncumbent = (
  challenger: number,
  incumbent: number,
  previousFreshness: number,
): boolean =>
  previousFreshness > 0.25 &&
  challenger - incumbent < BELIEF_RULES.hysteresisMargin;

interface ChainResult {
  readonly state: BeliefState;
  readonly freshness: number;
}

/**
 * Test seams for __tests__/projector-chain.test.ts — not part of the belief
 * contract. `referenceHysteresisChain` is the pre-R2 chain verbatim (every
 * checkpoint evaluated over the whole prefix, O(n²)), kept as the oracle the
 * window-local chain is checked against; `windowHysteresisChain` runs the
 * production chain over the same normalized window.
 */
export const referenceHysteresisChain = (
  inputEvents: readonly ContextEventRecord[],
  asOfInput: string,
): ChainResult => {
  const events = normalizeEvents(inputEvents, Date.parse(asOfInput));
  let previousState: BeliefState = "UNKNOWN";
  let previousFreshness = 0;
  for (let index = 0; index < events.length; index += 1) {
    const checkpointEvents = events.slice(0, index + 1);
    const checkpoint = checkpointEvents.at(-1)?.occurredAt;
    if (checkpoint === undefined) {
      continue;
    }
    const evaluation = evaluate(checkpointEvents, Date.parse(checkpoint));
    previousState = applyHysteresis(
      evaluation.rawState,
      evaluation.distribution,
      previousState,
      previousFreshness,
    ).state;
    previousFreshness = evaluation.freshness;
  }
  return { state: previousState, freshness: previousFreshness };
};

export const windowHysteresisChain = (
  inputEvents: readonly ContextEventRecord[],
  asOfInput: string,
  memo?: BeliefChainMemo,
): ChainResult =>
  runHysteresisChain(normalizeEvents(inputEvents, Date.parse(asOfInput)), memo);

const STATE_INDEX = Object.fromEntries(
  BELIEF_STATES.map((state, index) => [state, index]),
) as Readonly<Record<BeliefState, number>>;
const UNKNOWN_INDEX = STATE_INDEX.UNKNOWN;

/**
 * Carries the state hysteresis across the window: the state and freshness
 * the final evaluation inherits, as if the stream had been evaluated at every
 * event in turn (`events` is normalized: ascending by occurredAt, then
 * serverSequence).
 *
 * Each checkpoint is evaluated over the events within evidenceWindowMs of it
 * rather than the whole prefix — the same evaluation for everything the
 * chain reads (chain-memo.ts explains why) at O(window) instead of O(i). With
 * a memo, checkpoints whose window did not change since the last projection
 * of this stream are not evaluated at all. The fold itself is always re-run.
 */
const runHysteresisChain = (
  events: readonly ContextEventRecord[],
  memo: BeliefChainMemo | undefined,
): ChainResult => {
  const size = events.length;
  // With a memo the chain arrays are borrowed and handed back at commit —
  // a steady-state projection allocates none of them (chain-memo.ts).
  const generation =
    memo === undefined ? createChainGeneration(size) : memo.borrow(size);
  const { occurredMs, checkpoints } = generation;
  for (let index = 0; index < size; index += 1) {
    // Finite: normalizeEvents dropped every event whose occurredAt is not.
    occurredMs[index] = Date.parse(events[index]!.occurredAt);
  }
  const reuse = memo?.plan(events, occurredMs);

  let windowStart = 0;
  for (let index = 0; index < size; index += 1) {
    const checkpointMs = occurredMs[index]!;
    while (
      occurredMs[windowStart]! <
      checkpointMs - BELIEF_RULES.evidenceWindowMs
    ) {
      windowStart += 1;
    }
    const reusable = reuse?.[index] ?? -1;
    if (memo !== undefined && reusable >= 0) {
      memo.copyInto(checkpoints, index, reusable);
      continue;
    }
    const evaluation = evaluate(
      events.slice(windowStart, index + 1),
      checkpointMs,
    );
    checkpoints.rawState[index] = STATE_INDEX[evaluation.rawState];
    checkpoints.freshness[index] = evaluation.freshness;
    const base = index * STATE_COUNT;
    for (let state = 0; state < STATE_COUNT; state += 1) {
      checkpoints.distribution[base + state] =
        evaluation.distribution[BELIEF_STATES[state]!];
    }
  }

  let state = UNKNOWN_INDEX;
  let freshness = 0;
  for (let index = 0; index < size; index += 1) {
    state = hysteresisStep(checkpoints, index, state, freshness);
    freshness = checkpoints.freshness[index]!;
  }
  memo?.commit(events, generation);
  return { state: BELIEF_STATES[state]!, freshness };
};

/** applyHysteresis over the stored checkpoint, on state indexes. */
const hysteresisStep = (
  checkpoints: ChainCheckpoints,
  index: number,
  previousState: number,
  previousFreshness: number,
): number => {
  const rawState = checkpoints.rawState[index]!;
  if (
    rawState === UNKNOWN_INDEX ||
    previousState === UNKNOWN_INDEX ||
    rawState === previousState
  ) {
    return rawState;
  }
  const base = index * STATE_COUNT;
  return retainsIncumbent(
    checkpoints.distribution[base + rawState]!,
    checkpoints.distribution[base + previousState]!,
    previousFreshness,
  )
    ? previousState
    : rawState;
};

const buildFactors = (
  facts: EvaluationFacts,
  state: BeliefState,
  stateConfidence: number,
  asOfMs: number,
  evidence: readonly EvidenceRef[],
): BeliefFactors => {
  const latest = facts.meaningfulEvents.at(-1);
  const ageMs =
    latest === undefined
      ? Number.POSITIVE_INFINITY
      : asOfMs - Date.parse(latest.occurredAt);
  const session = facts.latestSession;
  const sessionFresh =
    session !== undefined &&
    asOfMs - Date.parse(session.event.occurredAt) <=
      BELIEF_RULES.activeWindowMs;

  let activity: ActivityFactor = "UNKNOWN";
  if (sessionFresh && session?.status === "inactive") {
    activity = "INACTIVE";
  } else if (sessionFresh && session?.status === "idle") {
    activity = "IDLE";
  } else if (latest !== undefined && ageMs <= BELIEF_RULES.activeWindowMs) {
    activity = "ACTIVE";
  } else if (latest !== undefined && ageMs <= BELIEF_RULES.waitWindowMs) {
    activity = "IDLE";
  } else if (latest !== undefined && ageMs <= BELIEF_RULES.evidenceWindowMs) {
    activity = "INACTIVE";
  }

  const recentTests = facts.testEvents.filter(
    ({ event }) =>
      asOfMs - Date.parse(event.occurredAt) <= BELIEF_RULES.testWindowMs,
  );
  const latestTest = recentTests.at(-1);
  let outcome: OutcomeFactor = "UNKNOWN";
  if (facts.conflictingTests) {
    outcome = "MIXED";
  } else if (latestTest?.status === "passed") {
    outcome = "SUCCESS";
  } else if (latestTest?.status === "failed") {
    outcome = "FAILURE";
  }

  let attention: AttentionFactor = "UNKNOWN";
  if (activity === "INACTIVE") {
    attention = "DISENGAGED";
  } else if (facts.sustainedEditing) {
    attention = "DEEP";
  } else if (activity === "ACTIVE") {
    attention = "SHALLOW";
  }

  const workMode = workModeForState(state);
  const latestTestEvent = latestTest?.event;
  const latestEdit = facts.editEvents.at(-1);
  const activityReference = session?.event ?? latest;
  const attentionReference = latestEdit ?? activityReference;
  const activityFreshness = eventFreshness(
    activityReference,
    asOfMs,
    BELIEF_RULES.evidenceWindowMs,
  );
  const workModeFreshness = eventFreshness(
    latest,
    asOfMs,
    BELIEF_RULES.evidenceWindowMs,
  );
  const outcomeFreshness = eventFreshness(
    latestTestEvent,
    asOfMs,
    BELIEF_RULES.testWindowMs,
  );
  const attentionFreshness = eventFreshness(
    attentionReference,
    asOfMs,
    BELIEF_RULES.editingWindowMs,
  );

  return {
    activity: factorBelief(
      activity,
      activity === "UNKNOWN"
        ? 0
        : sessionFresh
          ? 0.95
          : 0.75 * activityFreshness,
      activityFreshness,
      evidence,
      "activity",
    ),
    workMode: factorBelief(
      workMode,
      state === "UNKNOWN" ? 0 : stateConfidence,
      workModeFreshness,
      evidence,
      "workMode",
    ),
    outcome: factorBelief(
      outcome,
      outcome === "UNKNOWN" ? 0 : outcome === "MIXED" ? 0.5 : 0.9,
      outcomeFreshness,
      evidence,
      "outcome",
    ),
    attention: factorBelief(
      attention,
      attention === "UNKNOWN" ? 0 : attention === "SHALLOW" ? 0.65 : 0.9,
      attentionFreshness,
      evidence,
      "attention",
    ),
  };
};

const factorBelief = <TValue extends string>(
  value: TValue,
  confidence: number,
  freshness: number,
  evidence: readonly EvidenceRef[],
  factor: FactorName,
) => ({
  value,
  confidence: round(confidence),
  freshness: round(freshness),
  evidence: evidence
    .filter((entry) => entry.factor === factor || entry.factor === "state")
    .slice(-12),
});

const eventFreshness = (
  event: ContextEventRecord | undefined,
  asOfMs: number,
  windowMs: number,
): number =>
  event === undefined
    ? 0
    : freshnessForAge(asOfMs - Date.parse(event.occurredAt), windowMs);

const workModeForState = (state: BeliefState): WorkModeFactor => {
  switch (state) {
    case "SETUP":
      return "SETTING_UP";
    case "EXPLORE":
      return "EXPLORING";
    case "BUILD":
      return "EDITING";
    case "DEBUG":
      return "TESTING";
    case "REVIEW":
      return "REVIEWING";
    case "WAIT":
      return "WAITING";
    case "BREAK":
      return "RESTING";
    case "UNKNOWN":
      return "UNKNOWN";
  }
};

const isRecognizedEvent = (
  event: ContextEventRecord,
  data: Readonly<Record<string, JsonValue>> | undefined,
): boolean => {
  switch (event.type) {
    case "muses.environment.setup":
      return data !== undefined;
    case "muses.process.activity": {
      const status = readString(data, "status");
      return (
        status === "started" ||
        status === "waiting" ||
        status === "completed" ||
        status === "failed"
      );
    }
    case "muses.editor.activity": {
      const action = readString(data, "action");
      return (
        action === "edit" ||
        action === "save" ||
        action === "navigate" ||
        action === "open"
      );
    }
    case "muses.test.run.completed": {
      const status = readString(data, "status");
      return (
        status === "passed" || status === "failed" || status === "cancelled"
      );
    }
    case "muses.review.activity":
      return readString(data, "action") !== undefined;
    case "muses.session.activity": {
      const status = readString(data, "status");
      return status === "active" || status === "idle" || status === "inactive";
    }
    default:
      return false;
  }
};

const hasConflictingTests = (tests: readonly TestEvent[]): boolean => {
  for (let index = 1; index < tests.length; index += 1) {
    const previous = tests[index - 1];
    const current = tests[index];
    if (previous === undefined || current === undefined) {
      continue;
    }
    if (
      previous.status !== "cancelled" &&
      current.status !== "cancelled" &&
      previous.status !== current.status &&
      Date.parse(current.event.occurredAt) -
        Date.parse(previous.event.occurredAt) <=
        BELIEF_RULES.conflictWindowMs
    ) {
      return true;
    }
  }
  return false;
};

const addScore = (
  accumulator: ScoreAccumulator,
  state: BeliefState,
  contribution: number,
  ruleId: string,
  event: ContextEventRecord,
  factor: FactorName | "state",
): void => {
  if (contribution <= 0) {
    return;
  }
  accumulator.scores[state] += contribution;
  accumulator.evidence.push({
    ruleId,
    source: event.source,
    eventId: event.id,
    serverSequence: event.serverSequence,
    occurredAt: event.occurredAt,
    contribution: round(contribution),
    factor,
  });
};

const normalizeScores = (
  scores: Readonly<Record<BeliefState, number>>,
): BeliefDistribution => {
  const total = BELIEF_STATES.reduce((sum, state) => sum + scores[state], 0);
  const output: Record<BeliefState, number> = {
    SETUP: 0,
    EXPLORE: 0,
    BUILD: 0,
    DEBUG: 0,
    REVIEW: 0,
    WAIT: 0,
    BREAK: 0,
    UNKNOWN: 0,
  };
  let roundedTotal = 0;
  for (const state of BELIEF_STATES.slice(0, -1)) {
    output[state] = round(scores[state] / total);
    roundedTotal += output[state];
  }
  output.UNKNOWN = round(Math.max(0, 1 - roundedTotal));
  return output;
};

const freshnessForAge = (ageMs: number, windowMs: number): number => {
  if (!Number.isFinite(ageMs) || ageMs >= windowMs) {
    return 0;
  }
  if (ageMs <= 0) {
    return 1;
  }
  return 1 - ageMs / windowMs;
};

const deduplicateEvidence = (
  evidence: readonly EvidenceRef[],
): readonly EvidenceRef[] => {
  const seen = new Set<string>();
  const output: EvidenceRef[] = [];
  for (const entry of evidence) {
    const key = `${entry.ruleId}:${entry.serverSequence}:${entry.factor}`;
    if (!seen.has(key)) {
      seen.add(key);
      output.push(entry);
    }
  }
  return output.sort((left, right) =>
    left.serverSequence === right.serverSequence
      ? left.ruleId.localeCompare(right.ruleId)
      : left.serverSequence - right.serverSequence,
  );
};

/**
 * Byte-identical to hashing JSON.stringify({rulesetVersion, asOf, events:
 * [{source, id, serverSequence, contentHash, occurredAt, expiresAt}]}) but
 * streamed per event and per field: the object form materialized a ~250KB
 * string (a 2000-event window) plus 2000 wrapper objects on every
 * projection — a large-object allocation that kept the old generation
 * growing until the next major GC. Every field of ContextEventRecord is a
 * required string or a finite integer, so key order is fixed and each value
 * stringifies exactly as JSON.stringify would render it.
 */
const digestProjection = (
  events: readonly ContextEventRecord[],
  asOf: string,
): string => {
  const hash = createHash("sha256");
  hash.update(`{"rulesetVersion":${JSON.stringify(BELIEF_RULESET_VERSION)}`);
  hash.update(`,"asOf":${JSON.stringify(asOf)},"events":[`);
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]!;
    hash.update(
      `${index === 0 ? "" : ","}{"source":${JSON.stringify(event.source)}` +
        `,"id":${JSON.stringify(event.id)}` +
        `,"serverSequence":${JSON.stringify(event.serverSequence)}` +
        `,"contentHash":${JSON.stringify(event.contentHash)}` +
        `,"occurredAt":${JSON.stringify(event.occurredAt)}` +
        `,"expiresAt":${JSON.stringify(event.expiresAt)}}`,
    );
  }
  hash.update("]}");
  return hash.digest("hex");
};

const asRecord = (
  value: JsonValue | undefined,
): Readonly<Record<string, JsonValue>> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, JsonValue>>)
    : undefined;

const readString = (
  record: Readonly<Record<string, JsonValue>> | undefined,
  key: string,
): string | undefined => {
  const value = record?.[key];
  return typeof value === "string" ? value : undefined;
};

const round = (value: number): number =>
  Math.round(value * 1_000_000) / 1_000_000;
