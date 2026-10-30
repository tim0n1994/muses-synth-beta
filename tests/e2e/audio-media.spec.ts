import { expect, test, type Page } from "@playwright/test";
import {
  installSynthProbe,
  readSynthProbe,
} from "../../src/web/player/__browser__/synth-probe.js";

const sample = (page: Page) => page.evaluate(readSynthProbe);
const receipt = (page: Page) => page.locator("#receipt");
const snapshot = (page: Page) => page.locator("#snapshot");
const click = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true }).click();
const observations = new WeakMap<
  Page,
  { forbidden: string[]; errors: string[] }
>();

test.beforeEach(async ({ page }) => {
  const observation = { forbidden: [] as string[], errors: [] as string[] };
  observations.set(page, observation);
  page.on("pageerror", (error) => observation.errors.push(error.message));
  await page.addInitScript(installSynthProbe);
  // Reject even attempted access to recordings/accounts/external services.
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (
      url.origin !== "http://127.0.0.1:18437" ||
      /^\/(audio|library|api)(\/|$)/u.test(url.pathname)
    ) {
      observation.forbidden.push(url.origin + url.pathname);
      return route.abort();
    }
    return route.continue();
  });
});

test.afterEach(async ({ page }) => {
  expect(observations.get(page)).toEqual({ forbidden: [], errors: [] });
});

async function audible(page: Page) {
  await expect
    .poll(async () =>
      (await sample(page)).outputs.some(
        (value) =>
          value.state === "running" && value.gain > 0 && value.rms > 0.00001,
      ),
    )
    .toBe(true);
}
async function suspended(page: Page) {
  await expect
    .poll(async () =>
      (await sample(page)).outputs.every(
        (value) => value.state === "suspended" && value.gain === 0,
      ),
    )
    .toBe(true);
  const before = await sample(page);
  await page.waitForTimeout(350);
  expect((await sample(page)).outputs.map((value) => value.time)).toEqual(
    before.outputs.map((value) => value.time),
  );
}
async function attach(page: Page) {
  const observation = await sample(page);
  expect(observation.mediaSources).toBe(0);
  expect(observation.mediaElements).toBe(0);
  await test.info().attach("synth-output-observation", {
    body: JSON.stringify({
      ...observation,
      listeningAcceptance: "NOT_EVALUATED",
    }),
    contentType: "application/json",
  });
}

test("default runtime requires a gesture, emits PCM, and respects manual cooldown/pause", async ({
  page,
}) => {
  await page.goto("/src/web/player/__browser__/fixture.html");
  await click(page, "transition");
  await expect(receipt(page)).toContainText("EXPLICIT_START_REQUIRED");
  expect((await sample(page)).outputs).toHaveLength(0);
  await click(page, "play");
  await expect(receipt(page)).toContainText("MANUAL_START");
  await audible(page);
  await expect(snapshot(page)).toContainText('"currentProfile":"flow"');
  await click(page, "transition");
  await expect(receipt(page)).toContainText("MANUAL_COOLDOWN");
  await expect(snapshot(page)).toContainText('"currentProfile":"flow"');
  await attach(page);
  await click(page, "pause");
  await expect(receipt(page)).toContainText("MANUAL_PAUSE");
  await suspended(page);
  await click(page, "transition");
  await expect(receipt(page)).toContainText("MANUALLY_PAUSED");
  await suspended(page);
  await click(page, "play");
  await expect(receipt(page)).toContainText("MANUAL_START");
  await audible(page);
});

test("real synth crossfade retires old oscillators and keeps output advancing", async ({
  page,
}) => {
  await page.goto("/src/web/player/__browser__/fixture.html?noCooldown");
  await click(page, "play");
  await expect(receipt(page)).toContainText("MANUAL_START");
  await audible(page);
  const before = await sample(page);
  await click(page, "transition");
  await expect(receipt(page)).toContainText("PROFILE_APPLIED");
  await expect(snapshot(page)).toContainText('"currentProfile":"audit"');
  await audible(page);
  await expect
    .poll(async () =>
      (await sample(page)).oscillators
        .slice(0, 2)
        .every((value) => value.stopped),
    )
    .toBe(true);
  const after = await sample(page);
  const frequencies = after.oscillators
    .filter((value) => !value.stopped)
    .map((value) => value.frequency);
  expect(frequencies).toHaveLength(2);
  expect(frequencies[0]).toBeCloseTo(130.81, 2);
  expect(frequencies[1]).toBeCloseTo(261.63, 2);
  expect(after.outputs[0]!.time - before.outputs[0]!.time).toBeGreaterThan(1);
  await attach(page);
});

test("manual pause beats an in-flight synth transition and restart", async ({
  page,
}) => {
  await page.goto("/src/web/player/__browser__/fixture.html?noCooldown");
  await click(page, "play");
  await expect(receipt(page)).toContainText("MANUAL_START");
  await click(page, "transition");
  await expect
    .poll(async () => (await sample(page)).oscillators.length)
    .toBe(4);
  await click(page, "pause");
  await expect(snapshot(page)).toContainText('"paused":true');
  await suspended(page);
  await click(page, "play");
  // Cancel while profile fade is pending; no fabricated clock or facade.
  await expect
    .poll(async () => (await sample(page)).oscillators.length)
    .toBe(6);
  await click(page, "pause");
  await expect(receipt(page)).toContainText("MANUAL_PAUSE");
  await suspended(page);
  await click(page, "transition");
  await expect(receipt(page)).toContainText("MANUALLY_PAUSED");
  await attach(page);
});

test("unavailable native audio reports failure without starting playback", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "AudioContext", { value: undefined });
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/src/web/player/__browser__/fixture.html");
  await click(page, "play");
  await expect(receipt(page)).toContainText('"status":"failed"');
  await expect(snapshot(page)).toContainText('"started":false');
  expect(errors).toEqual([]);
});

test("new Play survives an older delayed suspend in real Chromium audio", async ({
  page,
}) => {
  // Control only the async boundary; retain Chromium's native context, sources,
  // suspend/resume and PCM. This forces the order a quick gesture can encounter.
  await page.addInitScript(() => {
    const suspend = AudioContext.prototype.suspend;
    AudioContext.prototype.suspend = function () {
      const control = window as unknown as {
        __suspendPending: boolean;
        __releaseSuspend: () => void;
      };
      control.__suspendPending = true;
      return new Promise<void>((resolve, reject) => {
        control.__releaseSuspend = () => {
          void suspend.call(this).then(resolve, reject);
        };
      });
    };
  });
  await page.goto("/src/web/player/__browser__/fixture.html");
  await click(page, "play");
  await expect(receipt(page)).toContainText("MANUAL_START");
  await audible(page);
  await click(page, "pause");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __suspendPending: boolean }).__suspendPending,
      ),
    )
    .toBe(true);
  await click(page, "play");
  await page.evaluate(() =>
    (window as unknown as { __releaseSuspend: () => void }).__releaseSuspend(),
  );
  await expect(receipt(page)).toContainText('"status":"applied"');
  await audible(page);
  await expect(snapshot(page)).toContainText('"paused":false');
  await attach(page);
  await click(page, "dispose");
});

test("dispose during a real crossfade closes the context and all sources", async ({
  page,
}) => {
  await page.goto("/src/web/player/__browser__/fixture.html?noCooldown");
  await click(page, "play");
  await expect(receipt(page)).toContainText("MANUAL_START");
  await click(page, "transition");
  await expect
    .poll(async () => (await sample(page)).oscillators.length)
    .toBe(4);
  await click(page, "dispose");
  await expect
    .poll(async () => (await sample(page)).outputs[0]?.state)
    .toBe("closed");
  await expect
    .poll(async () =>
      (await sample(page)).sources.every((value) => value.stopRequested),
    )
    .toBe(true);
  await expect(receipt(page)).toContainText('"status":"disposed"');
  await click(page, "play");
  await expect(receipt(page)).toContainText('"status":"failed"');
  expect((await sample(page)).outputs).toHaveLength(1);
  await attach(page);
});
