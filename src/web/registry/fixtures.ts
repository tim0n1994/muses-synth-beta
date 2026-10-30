import type { DashboardConfigInput, RegistryCapability } from "./types";

export const allRegistryCapabilities: readonly RegistryCapability[] = [
  "belief:read",
  "evidence:read",
  "events:read",
  "decision:read",
  "effect.audio:read",
  "effect.audio:write",
  "metrics:read",
  "privacy:read",
];

export const representativeDashboardConfig: DashboardConfigInput = {
  schemaVersion: "1.0",
  dashboardId: "developer-context",
  title: "Developer context",
  sections: [
    {
      id: "state",
      type: "state.hero",
      schemaVersion: "1.0",
      layout: { columnSpan: { sm: 4, md: 8, lg: 8 }, order: 1 },
      props: {
        status: "BUILD",
        confidence: 0.78,
        summary:
          "Sustained implementation activity with low interruption risk.",
        updatedAt: "local event time",
      },
    },
    {
      id: "privacy",
      type: "privacy.status",
      schemaVersion: "1.0",
      layout: { columnSpan: { sm: 4, md: 4, lg: 4 }, order: 2 },
      props: {
        localOnly: true,
        sensors: ["editor", "git", "foreground application"],
        retention: "7d",
        pendingDeletionCount: 0,
      },
    },
    {
      id: "belief",
      type: "belief.distribution",
      schemaVersion: "1.0",
      layout: { columnSpan: { sm: 4, md: 4, lg: 6 }, order: 3 },
      props: {
        factors: [
          {
            id: "editor-flow",
            label: "Editor continuity",
            probability: 0.84,
            direction: 1,
            evidenceCount: 12,
          },
          {
            id: "interruptions",
            label: "Interruption pressure",
            probability: 0.18,
            direction: -1,
            evidenceCount: 4,
          },
          {
            id: "uncertainty",
            label: "Task uncertainty",
            probability: 0.45,
            direction: 0,
            evidenceCount: 3,
          },
        ],
      },
    },
    {
      id: "evidence",
      type: "evidence.list",
      schemaVersion: "1.0",
      layout: { columnSpan: { sm: 4, md: 4, lg: 6 }, order: 4 },
      props: {
        evidence: [
          {
            id: "ev-1",
            label: "Continuous source edits",
            source: "editor events",
            weight: 0.72,
            explanation: "File edits remained within one task cluster.",
          },
          {
            id: "ev-2",
            label: "Build failure",
            source: "local task runner",
            weight: -0.22,
            explanation: "One recoverable failure was observed.",
          },
        ],
      },
    },
    {
      id: "events",
      type: "events.timeline",
      schemaVersion: "1.0",
      layout: { columnSpan: { sm: 4, md: 4, lg: 6 }, order: 5 },
      props: {
        events: [
          {
            id: "event-1",
            kind: "editor",
            title: "Edited registry schema",
            occurredAt: "10:31",
          },
          {
            id: "event-2",
            kind: "test",
            title: "Started local test run",
            occurredAt: "10:34",
          },
        ],
      },
    },
    {
      id: "decision",
      type: "decision.card",
      schemaVersion: "1.0",
      layout: { columnSpan: { sm: 4, md: 4, lg: 6 }, order: 6 },
      props: {
        decision: "NO_ACTION",
        confidence: 0.66,
        rationale: "Evidence does not justify interrupting the current task.",
        reversible: true,
      },
    },
    {
      id: "audio",
      type: "audio.control",
      schemaVersion: "1.0",
      layout: { columnSpan: { sm: 4, md: 4, lg: 6 }, order: 7 },
      props: {
        playing: true,
        trackTitle: "Low-variance ambient",
        volume: 34,
        muted: false,
      },
    },
    {
      id: "metrics",
      type: "metrics.grid",
      schemaVersion: "1.0",
      layout: { columnSpan: { sm: 4, md: 4, lg: 6 }, order: 8 },
      props: {
        metrics: [
          {
            id: "switches",
            label: "Context switches",
            value: "2",
            trend: "flat",
          },
          { id: "focus", label: "Focus window", value: "41 min", trend: "up" },
          {
            id: "unknown",
            label: "Unknown inputs",
            value: "1",
            trend: "unknown",
          },
        ],
      },
    },
  ],
};
