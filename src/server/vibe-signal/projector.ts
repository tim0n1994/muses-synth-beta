import { createHash } from "node:crypto";

import type { ContextEventRecord, JsonValue } from "../context/model.js";
import type {
  EmotionBelief,
  EmotionTone,
  IntensityBelief,
  IntensityLevel,
  PulseEvidenceRef,
  PulseSnapshot,
  PulseUnknownReason,
  RhythmBelief,
  RhythmLevel,
  TransitionModulation,
} from "./model.js";
import { PULSE_RULE_IDS, PULSE_RULES, PULSE_RULESET_VERSION } from "./rules.js";

export interface ProjectPulseOptions {
  readonly maxEvents?: number;
}

const DEFAULT_MAX_EVENTS = 2_000;
const MAXIMUM_MAX_EVENTS = 10_000;

const RHYTHM_ORDER: readonly RhythmLevel[] = ["SLOW", "STEADY", "FAST"];
const INTENSITY_ORDER: readonly IntensityLevel[] = [
  "CALM",
  "STEADY",
  "INTENSE",
];
const RHYTHM_BOUNDARIES: readonly number[] = [
  PULSE_RULES.rhythm.slowMax,
  PULSE_RULES.rhythm.steadyMax,
];
const INTENSITY_BOUNDARIES: readonly number[] = [
  PULSE_RULES.intensity.calmMax,
  PULSE_RULES.intensity.steadyMax,
];

interface CountedEvent {
  readonly event: ContextEventRecord;
  readonly occurredMs: number;
  readonly weight: number;
  readonly valence: number;
  readonly valenceRuleId: string | undefined;
}

interface WindowStats {
  readonly count: number;
  readonly weightedRate: number;
  readonly intensityScore: number;
  readonly cv: number;
  readonly coverage: number;
}

interface HysteresisOutcome<TLevel extends string> {
  readonly level: TLevel;
  readonly retained: boolean;
  readonly challenger: TLevel | undefined;
}

const round = (value: number): number =>
  Math.round(value * 1_000_000) / 1_000_000;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/**
 * Pure, deterministic pulse projection over a 60s trailing window.
 *
 * Same contract as projectBelief: the input order is not trusted (events
 * are deduplicated by (source, id) and reordered by occurredAt then
 * serverSequence), the same events + asOf always yield the same snapshot,
 * and every reported value carries an evidence ledger entry naming the
 * rule that produced it and the event it came from.
 *
 * Performance: timestamps are parsed once, window statistics are answered
 * from prefix sums (weighted rate, squared gaps) and a monotonic-deque
 * sliding maximum (largest internal gap), so the per-event hysteresis
 * checkpoint pass is O(n) total — a 1000-event window projects in
 * single-digit milliseconds, far inside the p95 < 50ms budget.
 */
export const projectPulse = (
  inputEvents: readonly ContextEventRecord[],
  asOfInput: string,
  options: ProjectPulseOptions = {},
): PulseSnapshot => {
  const asOfMs = Date.parse(asOfInput);
  if (!Number.isFinite(asOfMs)) {
    throw new Error("Pulse projection asOf must be a valid timestamp.");
  }
  const asOf = new Date(asOfMs).toISOString();
  const maxEvents = options.maxEvents ?? DEFAULT_MAX_EVENTS;
  if (
    !Number.isSafeInteger(maxEvents) ||
    maxEvents <= 0 ||
    maxEvents > MAXIMUM_MAX_EVENTS
  ) {
    throw new Error(
      "Pulse projection maxEvents must be an integer from 1 to 10000.",
    );
  }

  const events = normalizeEvents(inputEvents, asOfMs);
  if (events.length > maxEvents) {
    throw new Error(
      `Pulse replay exceeds the configured maximum of ${maxEvents} events.`,
    );
  }

  const windowStartMs = asOfMs - PULSE_RULES.windowMs;
  const windowEvents: ContextEventRecord[] = [];
  const counted: CountedEvent[] = [];
  for (const event of events) {
    const occurredMs = Date.parse(event.occurredAt);
    if (occurredMs <= windowStartMs) {
      continue;
    }
    windowEvents.push(event);
    const entry = classifyCounted(event, occurredMs);
    if (entry !== undefined) {
      counted.push(entry);
    }
  }

  // Prefix machinery for O(1) window statistics over counted[lo..hi]:
  // prefixWeight[i] = Σ weights below i; gapSq[i] = Σ squared internal
  // gaps up to and including the gap between events i-1 and i.
  const size = counted.length;
  const times = new Array<number>(size);
  const prefixWeight = new Array<number>(size + 1).fill(0);
  const gapSq = new Array<number>(size).fill(0);
  for (let index = 0; index < size; index += 1) {
    const entry = counted[index];
    if (entry === undefined) {
      continue;
    }
    times[index] = entry.occurredMs;
    prefixWeight[index + 1] = (prefixWeight[index] ?? 0) + entry.weight;
    if (index > 0) {
      const gap = entry.occurredMs - (counted[index - 1]?.occurredMs ?? 0);
      gapSq[index] = (gapSq[index - 1] ?? 0) + gap * gap;
    }
  }
  const gapAt = (index: number): number =>
    (times[index] ?? 0) - (times[index - 1] ?? 0);

  // Monotonic deque over internal gap indices, front = largest gap, valid
  // for the current window [lower, checkpoint].
  const maxDeque: number[] = [];
  const pushGap = (index: number): void => {
    const gap = gapAt(index);
    while (
      maxDeque.length > 0 &&
      gapAt(maxDeque[maxDeque.length - 1] ?? 0) <= gap
    ) {
      maxDeque.pop();
    }
    maxDeque.push(index);
  };
  const dropGapsAtOrBelow = (lower: number): void => {
    while (maxDeque.length > 0 && (maxDeque[0] ?? 0) <= lower) {
      maxDeque.shift();
    }
  };

  /**
   * Window statistics over counted[lower..upper] with the trailing window
   * ending at windowEndMs. The caller keeps the monotonic deque consistent
   * with (lower, upper] first.
   *
   * The gap sequence [head, between..., tail] partitions the full window,
   * so it always sums to windowMs and mean = windowMs / (n + 1). CV uses
   * the full sequence — burst-then-silence and silence-then-burst both
   * read as bursty. Coverage uses the same sequence minus the trailing gap
   * (what happened before the window's newest edge is the rhythm's
   * business), so sustained dense activity scores high coverage.
   */
  const statsFor = (
    lower: number,
    upper: number,
    windowEndMs: number,
  ): WindowStats => {
    const firstTime = times[lower];
    if (lower > upper || firstTime === undefined) {
      return {
        count: 0,
        weightedRate: 0,
        intensityScore: 0,
        cv: 0,
        coverage: 0,
      };
    }
    const lastTime = times[upper] ?? firstTime;
    const head = firstTime - (windowEndMs - PULSE_RULES.windowMs);
    const tail = windowEndMs - lastTime;
    const count = upper - lower + 1;
    const weightedRate =
      (prefixWeight[upper + 1] ?? 0) - (prefixWeight[lower] ?? 0);
    const sumSquares =
      head * head + tail * tail + ((gapSq[upper] ?? 0) - (gapSq[lower] ?? 0));
    const gapCount = count + 1;
    const mean = PULSE_RULES.windowMs / gapCount;
    const variance = Math.max(0, sumSquares / gapCount - mean * mean);
    const cv =
      mean > 0
        ? Math.sqrt(variance) / mean
        : clamp01(tail / PULSE_RULES.windowMs);
    const maxInternalGap = lower < upper ? gapAt(maxDeque[0] ?? upper) : 0;
    const coverage = clamp01(
      1 - Math.max(head, maxInternalGap) / PULSE_RULES.windowMs,
    );
    const intensityScore = clamp01(
      PULSE_RULES.intensity.cvWeight *
        Math.min(cv / PULSE_RULES.intensity.cvScale, 1) +
        PULSE_RULES.intensity.covWeight * coverage,
    );
    return { count, weightedRate, intensityScore, cv, coverage };
  };

  // Hysteresis needs the level trajectory, so the window is re-evaluated at
  // each counted event time (mirrors the belief projector's checkpoint
  // pass). Levels only change when the underlying score crosses a boundary
  // by more than the ±20% deadband (BELIEF_RULES.hysteresisMargin style).
  let previousRhythm: RhythmLevel | undefined;
  let previousIntensity: IntensityLevel | undefined;
  let lower = 0;
  for (let index = 0; index < size; index += 1) {
    const currentTime = times[index] ?? 0;
    const previousTime = times[index - 1];
    if (previousTime !== undefined && previousTime === currentTime) {
      continue;
    }
    if (index > 0) {
      pushGap(index);
    }
    while (
      lower < index &&
      (times[lower] ?? 0) <= currentTime - PULSE_RULES.windowMs
    ) {
      lower += 1;
    }
    dropGapsAtOrBelow(lower);
    const stats = statsFor(lower, index, currentTime);
    previousRhythm = applyLevelHysteresis(
      rhythmLevelFor(stats.weightedRate),
      previousRhythm,
      stats.weightedRate,
      RHYTHM_ORDER,
      RHYTHM_BOUNDARIES,
    ).level;
    previousIntensity = applyLevelHysteresis(
      intensityLevelFor(stats.intensityScore),
      previousIntensity,
      stats.intensityScore,
      INTENSITY_ORDER,
      INTENSITY_BOUNDARIES,
    ).level;
  }

  let windowLower = 0;
  while (windowLower < size && (times[windowLower] ?? 0) <= windowStartMs) {
    windowLower += 1;
  }
  dropGapsAtOrBelow(windowLower);
  const stats = statsFor(windowLower, size - 1, asOfMs);
  const rhythmHysteresis = applyLevelHysteresis(
    rhythmLevelFor(stats.weightedRate),
    previousRhythm,
    stats.weightedRate,
    RHYTHM_ORDER,
    RHYTHM_BOUNDARIES,
  );
  const intensityHysteresis = applyLevelHysteresis(
    intensityLevelFor(stats.intensityScore),
    previousIntensity,
    stats.intensityScore,
    INTENSITY_ORDER,
    INTENSITY_BOUNDARIES,
  );
  const rhythmLevel = rhythmHysteresis.level;
  const intensityLevel = intensityHysteresis.level;

  const windowCounted = counted.slice(windowLower);
  const explanation: string[] = [];
  const unknownReasons: PulseUnknownReason[] = [];

  let rhythm: RhythmBelief;
  let intensity: IntensityBelief;
  let emotion: EmotionBelief;

  if (windowCounted.length === 0) {
    unknownReasons.push("NO_RELEVANT_EVIDENCE");
    rhythm = { value: "UNKNOWN", score: 0, evidence: [] };
    intensity = { value: "UNKNOWN", score: 0, evidence: [] };
    emotion = {
      value: "UNKNOWN",
      tone: "UNKNOWN",
      transitionModulation: PULSE_RULES.modulation.default,
      evidence: [],
    };
    explanation.push(
      `${PULSE_RULE_IDS.pulseNoEvidence}: no counted events in the trailing ${PULSE_RULES.windowMs / 1_000}s window; rhythm, intensity and emotion are UNKNOWN. Keeping the current track is the player-side default, not a signal claim.`,
    );
  } else {
    const rhythmRuleId = rhythmRuleForLevel(rhythmLevel);
    const intensityRuleId = intensityRuleForLevel(intensityLevel);

    const rhythmEvidence = capEvidence(
      windowCounted.map((entry) =>
        evidenceEntry(entry, rhythmRuleId, entry.weight, "rhythm"),
      ),
    );
    const intensityEvidence = capEvidence(
      windowCounted.map((entry) =>
        evidenceEntry(entry, intensityRuleId, entry.weight, "intensity"),
      ),
    );

    // Emotion: V = Σ valence * (1 - age / window) with the same linear
    // decay as freshnessForAge; tanh bounds it to [-1, 1].
    let valenceSum = 0;
    const emotionEntries: PulseEvidenceRef[] = [];
    let lastValenced: CountedEvent | undefined;
    for (const entry of windowCounted) {
      if (entry.valence === 0) {
        continue;
      }
      const decay = clamp01((asOfMs - entry.occurredMs) / PULSE_RULES.windowMs);
      const contribution = entry.valence * (1 - decay);
      valenceSum += contribution;
      emotionEntries.push(
        evidenceEntry(
          entry,
          entry.valenceRuleId ?? "",
          contribution,
          "emotion",
        ),
      );
      lastValenced = entry;
    }
    const valence = Math.tanh(valenceSum);
    const tone = toneFor(valence);
    const modulation = modulationFor(valence);
    if (
      lastValenced !== undefined &&
      Math.abs(valence) > PULSE_RULES.emotion.toneThreshold
    ) {
      emotionEntries.push(
        evidenceEntry(
          lastValenced,
          PULSE_RULE_IDS.emotionModulation,
          Math.abs(valence),
          "emotion",
        ),
      );
    }

    rhythm = {
      value: rhythmLevel,
      score: round(stats.weightedRate),
      evidence: rhythmEvidence,
    };
    intensity = {
      value: intensityLevel,
      score: round(stats.intensityScore),
      evidence: intensityEvidence,
    };
    emotion = {
      value: round(valence),
      tone,
      transitionModulation: modulation,
      evidence: capEvidence(sortEvidence(emotionEntries)),
    };

    explanation.push(
      `Rhythm ${rhythmLevel}: weighted rate ${round(stats.weightedRate)} events per ${PULSE_RULES.windowMs / 1_000}s from ${windowCounted.length} counted events (rule ${rhythmRuleId}).`,
    );
    if (
      rhythmHysteresis.retained &&
      rhythmHysteresis.challenger !== undefined
    ) {
      explanation.push(
        `Hysteresis retained ${rhythmLevel}; challenger ${rhythmHysteresis.challenger} at rate ${round(stats.weightedRate)} stayed inside the ±${Math.round(PULSE_RULES.hysteresisMargin * 100)}% deadband.`,
      );
    }
    explanation.push(
      `Intensity ${intensityLevel}: burst CV ${round(stats.cv)} (scaled ${round(clamp01(stats.cv / PULSE_RULES.intensity.cvScale))}), coverage ${round(stats.coverage)} -> score ${round(stats.intensityScore)} (rule ${intensityRuleId}).`,
    );
    if (
      intensityHysteresis.retained &&
      intensityHysteresis.challenger !== undefined
    ) {
      explanation.push(
        `Hysteresis retained ${intensityLevel}; challenger ${intensityHysteresis.challenger} at score ${round(stats.intensityScore)} stayed inside the ±${Math.round(PULSE_RULES.hysteresisMargin * 100)}% deadband.`,
      );
    }
    explanation.push(
      `Emotion valence ${round(valence)} (${tone}) from ${emotionEntries.filter((entry) => entry.ruleId !== PULSE_RULE_IDS.emotionModulation).length} valenced events; transition modulation crossfadeMs=${modulation.crossfadeMs}, energyBias=${modulation.energyBias}.`,
    );
  }

  const lastServerSequence = events.reduce<number | undefined>(
    (current, event) =>
      current === undefined || event.serverSequence > current
        ? event.serverSequence
        : current,
    undefined,
  );

  const mergedEvidence = capEvidence(
    sortEvidence([
      ...rhythm.evidence,
      ...intensity.evidence,
      ...emotion.evidence,
    ]),
    PULSE_RULES.maxEvidencePerQuantity * 3,
  );

  return {
    asOf,
    windowStartedAt: new Date(windowStartMs).toISOString(),
    windowEndedAt: asOf,
    rhythm,
    intensity,
    emotion,
    evidence: mergedEvidence,
    unknownReasons,
    explanation,
    rulesetVersion: PULSE_RULESET_VERSION,
    inputDigest: digestProjection(windowEvents, asOf),
    ...(lastServerSequence === undefined ? {} : { lastServerSequence }),
  };
};

interface NormalizedEntry {
  readonly event: ContextEventRecord;
  readonly occurredMs: number;
}

/**
 * Admission + dedup + deterministic ordering, semantically identical to
 * the belief projector's normalizeEvents: invalid timestamps, future
 * events and expired events are dropped; duplicate (source, id) identities
 * keep the lowest serverSequence unless their content hashes conflict.
 * Timestamps are parsed exactly once here and reused downstream.
 */
const normalizeEvents = (
  inputEvents: readonly ContextEventRecord[],
  asOfMs: number,
): readonly ContextEventRecord[] => {
  const byIdentity = new Map<string, NormalizedEntry>();
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
    if (
      existing !== undefined &&
      existing.event.contentHash !== event.contentHash
    ) {
      throw new Error(
        `Conflicting duplicate event identity: ${event.source} / ${event.id}.`,
      );
    }
    if (
      existing === undefined ||
      event.serverSequence < existing.event.serverSequence
    ) {
      byIdentity.set(key, { event, occurredMs });
    }
  }
  return [...byIdentity.values()]
    .sort((left, right) =>
      left.occurredMs === right.occurredMs
        ? left.event.serverSequence - right.event.serverSequence
        : left.occurredMs - right.occurredMs,
    )
    .map((entry) => entry.event);
};

/**
 * Input event table: only the six recognized v0.6 event types participate,
 * with per-type rhythm weight and emotion valence. session.activity and
 * environment.setup are deliberately excluded (activity gate / not work
 * pulse). Cancelled test runs count as events with zero valence.
 */
const classifyCounted = (
  event: ContextEventRecord,
  occurredMs: number,
): CountedEvent | undefined => {
  const data = asRecord(event.data);
  switch (event.type) {
    case "muses.editor.activity": {
      const action = readString(data, "action");
      if (action === "edit" || action === "save") {
        return {
          event,
          occurredMs,
          weight: PULSE_RULES.weights.editSave,
          valence: 0,
          valenceRuleId: undefined,
        };
      }
      if (action === "navigate" || action === "open") {
        return {
          event,
          occurredMs,
          weight: PULSE_RULES.weights.navigateOpen,
          valence: 0,
          valenceRuleId: undefined,
        };
      }
      return undefined;
    }
    case "muses.process.activity": {
      const status = readString(data, "status");
      if (status === "started" || status === "waiting") {
        return {
          event,
          occurredMs,
          weight: PULSE_RULES.weights.processActivity,
          valence: 0,
          valenceRuleId: undefined,
        };
      }
      if (status === "completed") {
        return {
          event,
          occurredMs,
          weight: PULSE_RULES.weights.processActivity,
          valence: PULSE_RULES.valences.processCompleted,
          valenceRuleId: PULSE_RULE_IDS.valenceProcessCompleted,
        };
      }
      if (status === "failed") {
        return {
          event,
          occurredMs,
          weight: PULSE_RULES.weights.processActivity,
          valence: PULSE_RULES.valences.processFailed,
          valenceRuleId: PULSE_RULE_IDS.valenceProcessFailed,
        };
      }
      return undefined;
    }
    case "muses.test.run.completed": {
      const status = readString(data, "status");
      if (status === "passed") {
        return {
          event,
          occurredMs,
          weight: PULSE_RULES.weights.testRun,
          valence: PULSE_RULES.valences.testPassed,
          valenceRuleId: PULSE_RULE_IDS.valenceTestPassed,
        };
      }
      if (status === "failed") {
        return {
          event,
          occurredMs,
          weight: PULSE_RULES.weights.testRun,
          valence: PULSE_RULES.valences.testFailed,
          valenceRuleId: PULSE_RULE_IDS.valenceTestFailed,
        };
      }
      if (status === "cancelled") {
        return {
          event,
          occurredMs,
          weight: PULSE_RULES.weights.testRun,
          valence: PULSE_RULES.valences.testCancelled,
          valenceRuleId: undefined,
        };
      }
      return undefined;
    }
    case "muses.review.activity": {
      if (readString(data, "action") === undefined) {
        return undefined;
      }
      return {
        event,
        occurredMs,
        weight: PULSE_RULES.weights.review,
        valence: PULSE_RULES.valences.review,
        valenceRuleId: PULSE_RULE_IDS.valenceReview,
      };
    }
    default:
      return undefined;
  }
};

/**
 * 「挑战者须显著胜出」: when the raw level differs from the incumbent,
 * every boundary between them must be cleared by the hysteresis margin —
 * upward moves need score > boundary * 1.2, downward moves need
 * score < boundary * 0.8 — otherwise the incumbent is retained.
 */
const applyLevelHysteresis = <TLevel extends string>(
  raw: TLevel,
  previous: TLevel | undefined,
  score: number,
  order: readonly TLevel[],
  boundaries: readonly number[],
): HysteresisOutcome<TLevel> => {
  if (previous === undefined || raw === previous) {
    return { level: raw, retained: false, challenger: undefined };
  }
  const previousIndex = order.indexOf(previous);
  const rawIndex = order.indexOf(raw);
  if (previousIndex < 0 || rawIndex < 0) {
    return { level: raw, retained: false, challenger: undefined };
  }
  const margin = PULSE_RULES.hysteresisMargin;
  if (rawIndex > previousIndex) {
    for (let boundary = previousIndex; boundary < rawIndex; boundary += 1) {
      const threshold = boundaries[boundary];
      if (threshold === undefined || !(score > threshold * (1 + margin))) {
        return { level: previous, retained: true, challenger: raw };
      }
    }
  } else {
    for (let boundary = rawIndex; boundary < previousIndex; boundary += 1) {
      const threshold = boundaries[boundary];
      if (threshold === undefined || !(score < threshold * (1 - margin))) {
        return { level: previous, retained: true, challenger: raw };
      }
    }
  }
  return { level: raw, retained: false, challenger: undefined };
};

const rhythmLevelFor = (weightedRate: number): RhythmLevel =>
  weightedRate < PULSE_RULES.rhythm.slowMax
    ? "SLOW"
    : weightedRate < PULSE_RULES.rhythm.steadyMax
      ? "STEADY"
      : "FAST";

const intensityLevelFor = (score: number): IntensityLevel =>
  score < PULSE_RULES.intensity.calmMax
    ? "CALM"
    : score < PULSE_RULES.intensity.steadyMax
      ? "STEADY"
      : "INTENSE";

const rhythmRuleForLevel = (level: RhythmLevel): string =>
  level === "FAST"
    ? PULSE_RULE_IDS.rhythmRateHigh
    : level === "STEADY"
      ? PULSE_RULE_IDS.rhythmRateMid
      : level === "SLOW"
        ? PULSE_RULE_IDS.rhythmRateLow
        : PULSE_RULE_IDS.pulseNoEvidence;

const intensityRuleForLevel = (level: IntensityLevel): string =>
  level === "INTENSE"
    ? PULSE_RULE_IDS.intensityIntense
    : level === "STEADY"
      ? PULSE_RULE_IDS.intensitySteady
      : level === "CALM"
        ? PULSE_RULE_IDS.intensityCalm
        : PULSE_RULE_IDS.pulseNoEvidence;

const toneFor = (valence: number): EmotionTone =>
  valence >= PULSE_RULES.emotion.toneThreshold
    ? "POSITIVE"
    : valence <= -PULSE_RULES.emotion.toneThreshold
      ? "NEGATIVE"
      : "NEUTRAL";

const modulationFor = (valence: number): TransitionModulation =>
  valence < -PULSE_RULES.emotion.toneThreshold
    ? PULSE_RULES.modulation.negative
    : valence > PULSE_RULES.emotion.toneThreshold
      ? PULSE_RULES.modulation.positive
      : PULSE_RULES.modulation.default;

const evidenceEntry = (
  entry: CountedEvent,
  ruleId: string,
  contribution: number,
  factor: "rhythm" | "intensity" | "emotion",
): PulseEvidenceRef => ({
  ruleId,
  source: entry.event.source,
  eventId: entry.event.id,
  serverSequence: entry.event.serverSequence,
  occurredAt: entry.event.occurredAt,
  contribution: round(contribution),
  factor,
});

const sortEvidence = (
  evidence: readonly PulseEvidenceRef[],
): PulseEvidenceRef[] =>
  [...evidence].sort((left, right) =>
    left.serverSequence === right.serverSequence
      ? left.ruleId.localeCompare(right.ruleId)
      : left.serverSequence - right.serverSequence,
  );

const capEvidence = (
  evidence: readonly PulseEvidenceRef[],
  cap: number = PULSE_RULES.maxEvidencePerQuantity,
): readonly PulseEvidenceRef[] => deduplicateEvidence(evidence).slice(-cap);

const deduplicateEvidence = (
  evidence: readonly PulseEvidenceRef[],
): readonly PulseEvidenceRef[] => {
  const seen = new Set<string>();
  const output: PulseEvidenceRef[] = [];
  for (const entry of evidence) {
    const key = `${entry.ruleId}:${entry.serverSequence}:${entry.factor}`;
    if (!seen.has(key)) {
      seen.add(key);
      output.push(entry);
    }
  }
  return output;
};

const digestProjection = (
  events: readonly ContextEventRecord[],
  asOf: string,
): string =>
  createHash("sha256")
    .update(
      JSON.stringify({
        rulesetVersion: PULSE_RULESET_VERSION,
        asOf,
        events: events.map((event) => ({
          source: event.source,
          id: event.id,
          serverSequence: event.serverSequence,
          contentHash: event.contentHash,
          occurredAt: event.occurredAt,
          expiresAt: event.expiresAt,
        })),
      }),
    )
    .digest("hex");

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
