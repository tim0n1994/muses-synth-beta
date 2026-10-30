import { expect, test } from "@playwright/test";

const ROUTES = [
  "/",
  "/self-track",
  "/replay",
  "/signature",
  "/login",
  "/settings",
];

test.describe("SPA routes serve the shell (P0 defense)", () => {
  for (const route of ROUTES) {
    test(`GET ${route} returns HTML`, async ({ page }) => {
      const response = await page.goto(route, {
        waitUntil: "domcontentloaded",
      });
      expect(response?.status()).toBe(200);
      expect(response?.headers()["content-type"]).toContain("text/html");
      expect(await page.title()).toBe("Muses");
    });
  }

  test("assets load", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    expect(await page.locator("script[src]").count()).toBeGreaterThan(0);
  });

  test("anonymous has no v0.7 hint", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const body = await page.content();
    expect(body).not.toContain('"selfTrack":true');
  });
});
