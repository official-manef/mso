import { chromium, expect } from "@playwright/test";
import { releaseFixture } from "./release-fixture.mjs";
import { onboardingJourney } from "./onboarding.mjs";
import { agentProfilesJourney } from "./agent-profiles.mjs";
import { workflowSchedulesJourney } from "./workflow-schedules.mjs";

// These journeys persist real sessions; give them their own synthetic stores.
const fixture = await releaseFixture();
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(device => {
    localStorage.setItem("mso.device.id", device);
    localStorage.setItem("mso:onboarding:v1", "done");
  }, fixture.device);
  const page = await context.newPage(), errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(fixture.base + "/login?returnTo=%2Fintegrations");
  await page.locator('input[type="password"]').fill(fixture.password);
  await page.getByRole("button", { name: "Unlock", exact: true }).click();
  await expect(page).toHaveURL(fixture.base + "/integrations");
  await onboardingJourney(page, fixture);
  await agentProfilesJourney(page, fixture);
  await workflowSchedulesJourney(page, fixture);
  expect(errors).toEqual([]);
  await context.close();
} finally {
  await browser?.close();
  await fixture.close();
}
