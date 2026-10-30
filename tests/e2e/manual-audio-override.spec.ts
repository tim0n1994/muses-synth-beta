import { expect, test } from "@playwright/test";

import { apiRequest, asRecord, postJson } from "../helpers/api-client.js";
import { poll } from "../helpers/poll.js";
import { replayJsonLines } from "../helpers/replay.js";
import { getWebUrl } from "../helpers/test-config.js";

const DECISION_PATH = "/api/v1/decisions/current";
const EFFECT_PATH = "/api/v1/effects/current";
const OUTCOMES_PATH = "/api/v1/effects/outcomes";

function decisionOf(value: unknown): Record<string, unknown> | null {
  const body = asRecord(value, "decision response");
  return body.decision === null || body.decision === undefined
    ? null
    : asRecord(body.decision, "decision");
}

/**
 * PRD-v0.1 acceptance scenario 6: a manual audio override outranks automation
 * until its cooldown expires.
 *
 * Ordering contract: every spec drives one shared local server and one shared
 * SQLite file, and Playwright runs spec files in filename order with a single
 * worker. This file is named to sort after `belief-transition.spec.ts`, which
 * needs a virgin belief state; this one only needs *an* issued effect, which
 * it creates itself. Its replayed events carry their own id prefixes so they
 * can never collide with another spec's fixtures.
 *
 * Until v0.2.1 this could not pass at all — `AutomationOrchestrator` hardcoded
 * `lastManualOverrideAt: null`, so the engine's MANUAL_COOLDOWN branch was
 * unreachable. The browser now reports manual transport actions as effect
 * outcomes carrying a reserved reason, which is what this exercises.
 */
test("a manual override suppresses automation until its cooldown expires", async () => {
  // Drive the belief out of UNKNOWN so the policy engine has something to act
  // on and issues an effect.
  expect(
    await replayJsonLines("tests/fixtures/replay/belief-transition.jsonl", {
      anchorToNow: true,
      idPrefix: "override-arm",
    }),
  ).toBe(5);

  const issued = await poll(
    async () => await apiRequest(EFFECT_PATH, { method: "GET" }),
    (response) => {
      if (response.status !== 200) {
        return false;
      }
      const effect = asRecord(response.json, "effect response").effect;
      return effect !== null && effect !== undefined;
    },
  );
  const effect = asRecord(
    asRecord(issued.json, "effect response").effect,
    "effect ledger entry",
  );
  const request = asRecord(effect.request, "effect request");
  const effectId = String(request.effectId);

  // Report a manual pause exactly as the dashboard's audio runtime does.
  const paused = await postJson(OUTCOMES_PATH, {
    outcomeId: `outcome_e2e_${Date.now().toString(36)}`,
    effectId,
    status: "skipped",
    reason: "MANUAL_PAUSE",
    detail: null,
    observedAt: new Date().toISOString(),
  });
  expect(paused.status).toBe(200);

  // New evidence arrives. The engine must decline rather than resume audio.
  expect(
    await replayJsonLines("tests/fixtures/replay/belief-transition.jsonl", {
      anchorToNow: true,
      idPrefix: "override-cooldown",
    }),
  ).toBe(5);

  const afterOverride = await poll(
    async () => await apiRequest(DECISION_PATH, { method: "GET" }),
    (response) => {
      const decision = decisionOf(response.json);
      return decision !== null && decision.kind === "NO_ACTION";
    },
  );
  const decision = decisionOf(afterOverride.json);
  expect(decision?.kind).toBe("NO_ACTION");
  expect(decision?.reason).toBe("MANUAL_COOLDOWN");
});

test("the dashboard renders a reversible audio transport", async ({ page }) => {
  await page.goto(getWebUrl());

  const transport = page.locator(".muses-audio-controls");
  await expect(transport).toBeVisible();
  // The switch is the pause/resume affordance; a range gives manual gain.
  // Both are published affordances of the audio.control widget, so a settings
  // change that revokes manual override removes them.
  await expect(transport.getByRole("switch")).toBeVisible();
  await expect(transport.locator("input[type='range']")).toBeVisible();
});
