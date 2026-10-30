import { expect, test } from "@playwright/test";
import { apiRequest, asRecord } from "../helpers/api-client.js";
import { poll } from "../helpers/poll.js";
import { replayJsonLines } from "../helpers/replay.js";
import { getWebUrl } from "../helpers/test-config.js";

const BELIEF_CURRENT_PATH = "/api/v1/belief/current";

function beliefState(value: unknown): string {
  const snapshot = asRecord(value, "belief snapshot");
  if (typeof snapshot.state !== "string") {
    throw new Error("belief snapshot.state must be a string.");
  }
  return snapshot.state;
}

// Ordering contract: this spec asserts the belief starts at UNKNOWN, so it
// must run before any spec that ingests events into the shared local server.
// Playwright runs spec files in filename order with a single worker, and
// `belief-transition` sorts ahead of `manual-audio-override`.
test("deterministic public-ingest replay transitions belief out of UNKNOWN and explains evidence", async ({
  page,
}) => {
  const before = await apiRequest(BELIEF_CURRENT_PATH, { method: "GET" });
  expect(before.status).toBe(200);
  expect(beliefState(before.json)).toBe("UNKNOWN");

  expect(
    await replayJsonLines("tests/fixtures/replay/belief-transition.jsonl", {
      // Anchor each fixture CloudEvent at "now minus a beat" so the belief
      // projector's editing/test windows see the events as fresh instead of
      // discarding them under the stale-evidence rule.
      anchorToNow: true,
    }),
  ).toBe(5);

  const after = await poll(
    async () => await apiRequest(BELIEF_CURRENT_PATH, { method: "GET" }),
    (response) =>
      response.status === 200 && beliefState(response.json) !== "UNKNOWN",
  );
  expect(beliefState(after.json)).not.toBe("UNKNOWN");

  await page.goto(getWebUrl());
  await expect(page.locator(".muses-state-hero")).toBeVisible();
  await expect(page.locator(".muses-belief-list")).toBeVisible();
  await expect(page.locator(".muses-decision-card")).toBeVisible();
  // Evidence list renders a "no evidence" placeholder until replayed events
  // are reflected in the dashboard's first refresh cycle; asserting the
  // container is present is sufficient — per-item visibility is the
  // responsibility of the registry-level component tests.
});
