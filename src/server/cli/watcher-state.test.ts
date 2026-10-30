import { describe, expect, it } from "vitest";

import { WatcherState, type WatcherStateOptions } from "./watcher-state.js";

const OPTIONS: WatcherStateOptions = {
  debounceMs: 2_000,
  idleAfterMs: 5 * 60_000,
  inactiveAfterMs: 15 * 60_000,
  maxEventsPerMinute: 30,
  includePaths: false,
};

function create(overrides: Partial<WatcherStateOptions> = {}): WatcherState {
  return new WatcherState({ ...OPTIONS, ...overrides });
}

describe("WatcherState", () => {
  it("emits nothing until the debounce window has elapsed", () => {
    const state = create();
    state.onChange("src/a.ts", 0);

    expect(state.tick(1_999)).toEqual([]);
    expect(state.tick(2_000)).toEqual([
      { kind: "session", status: "active" },
      { kind: "editor", action: "save" },
    ]);
  });

  it("collapses a change storm into one event", () => {
    const state = create();
    // A `git checkout` or a build rewriting a thousand files must not become a
    // thousand pieces of evidence.
    for (let index = 0; index < 1_000; index += 1) {
      state.onChange(`src/file-${index}.ts`, index);
    }

    const emissions = state.tick(5_000);

    expect(emissions.filter((e) => e.kind === "editor")).toHaveLength(1);
    expect(state.counters()).toMatchObject({ changesSeen: 1_000, emitted: 1 });
  });

  it("produces the sustained-editing pattern the BUILD rule needs", () => {
    // BELIEF_RULES requires >= 3 edit events spanning >= 90s inside 5 minutes.
    const state = create({ debounceMs: 1_000 });
    const editorEvents: number[] = [];

    for (const at of [0, 60_000, 120_000]) {
      state.onChange("src/a.ts", at);
      for (const emission of state.tick(at + 1_000)) {
        if (emission.kind === "editor") {
          editorEvents.push(at + 1_000);
        }
      }
    }

    expect(editorEvents).toHaveLength(3);
    expect(editorEvents[2]! - editorEvents[0]!).toBeGreaterThanOrEqual(90_000);
  });

  it("caps editor events per rolling minute and counts what it suppressed", () => {
    const state = create({ debounceMs: 0, maxEventsPerMinute: 2 });

    for (let index = 0; index < 5; index += 1) {
      state.onChange(`src/file-${index}.ts`, index * 1_000);
      state.tick(index * 1_000);
    }

    expect(state.counters()).toMatchObject({
      emitted: 2,
      suppressedByRateLimit: 3,
    });
  });

  it("lets the rate limit recover once the minute rolls over", () => {
    const state = create({ debounceMs: 0, maxEventsPerMinute: 1 });
    state.onChange("a.ts", 0);
    state.tick(0);
    state.onChange("b.ts", 30_000);
    state.tick(30_000);
    state.onChange("c.ts", 61_000);
    state.tick(61_000);

    expect(state.counters()).toMatchObject({
      emitted: 2,
      suppressedByRateLimit: 1,
    });
  });

  it("moves the session to idle and then inactive as quiet time accumulates", () => {
    const state = create({ debounceMs: 0 });
    state.onChange("a.ts", 0);
    expect(state.tick(0)).toContainEqual({
      kind: "session",
      status: "active",
    });

    expect(state.tick(4 * 60_000)).toEqual([]);
    expect(state.tick(5 * 60_000)).toEqual([
      { kind: "session", status: "idle" },
    ]);
    expect(state.tick(15 * 60_000)).toEqual([
      { kind: "session", status: "inactive" },
    ]);
  });

  it("emits session transitions once, not on every tick", () => {
    const state = create({ debounceMs: 0 });
    state.onChange("a.ts", 0);
    state.tick(0);
    state.tick(5 * 60_000);

    // The projector reads only the latest session event, so repeating it would
    // be pure noise on a machine that is simply quiet.
    expect(state.tick(6 * 60_000)).toEqual([]);
    expect(state.tick(7 * 60_000)).toEqual([]);
  });

  it("reactivates the session when work resumes", () => {
    const state = create({ debounceMs: 0 });
    state.onChange("a.ts", 0);
    state.tick(0);
    state.tick(5 * 60_000);

    state.onChange("b.ts", 6 * 60_000);

    expect(state.tick(6 * 60_000)).toEqual([
      { kind: "session", status: "active" },
      { kind: "editor", action: "save" },
    ]);
  });

  it("omits file paths unless they were explicitly opted in", () => {
    const withoutPaths = create({ debounceMs: 0 });
    withoutPaths.onChange("src/secret-project/plan.md", 0);
    expect(withoutPaths.tick(0)).toContainEqual({
      kind: "editor",
      action: "save",
    });

    const withPaths = create({ debounceMs: 0, includePaths: true });
    withPaths.onChange("src/secret-project/plan.md", 0);
    expect(withPaths.tick(0)).toContainEqual({
      kind: "editor",
      action: "save",
      path: "src/secret-project/plan.md",
    });
  });

  it("stays silent when nothing has ever happened", () => {
    const state = create();
    expect(state.tick(60 * 60_000)).toEqual([]);
    expect(state.counters()).toMatchObject({ emitted: 0, changesSeen: 0 });
  });
});
