import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { getWebUrl } from "../helpers/test-config.js";

for (const path of ["/", "/settings"]) {
  test(`a11y smoke has no serious or critical automated violations on ${path}`, async ({
    page,
  }) => {
    await page.goto(`${getWebUrl()}${path}`);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
      .analyze();
    const blocking = results.violations.filter(
      (violation) =>
        violation.impact === "serious" || violation.impact === "critical",
    );
    expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([]);
  });
}
