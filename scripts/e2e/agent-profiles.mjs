import { expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

export async function agentProfilesJourney(page, fixture) {
  const call = (route, body) => page.evaluate(async ([route, body]) => {
    const response = await fetch(route, body === undefined ? { cache: "no-store" } : {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  }, [route, body]);
  const read = async () => {
    const result = await call("/api/v1/agent-profiles"); expect(result.status).toBe(200); return result.body.store;
  };
  await page.goto(fixture.base + "/assistant/agents");
  await expect(page.getByRole("heading", { name: "Saved agent profiles", exact: true })).toBeVisible();
  const personas = await page.evaluate(() => localStorage.getItem("alfa.agents"));
  await page.getByRole("button", { name: "New saved profile", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Fixture reader");
  await page.getByLabel("Initials", { exact: true }).fill("FR");
  await page.getByLabel("Instructions", { exact: true }).fill("Report the fixture files you inspect.");
  await page.getByLabel("Provider ID", { exact: true }).fill("fixture-unconfigured");
  await page.getByLabel("Model ID", { exact: true }).fill("fixture/reader");
  await page.getByRole("checkbox", { name: /^fs_read\b/ }).check();
  await page.getByRole("button", { name: "Save profile", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Fixture reader", exact: true })).toBeVisible();
  let store = await read(), profile = store.profiles.find(row => row.config.name === "Fixture reader");
  expect(profile.config.tools).toEqual(["fs_read"]); expect(profile.revision).toBe(1);
  expect(store.defaultProfileId).toBe(profile.id);
  const originalId = profile.id;

  await page.reload();
  await page.getByRole("button", { name: "Edit profile", exact: true }).click();
  await expect(page.getByLabel("Instructions", { exact: true })).toHaveValue("Report the fixture files you inspect.");
  await page.getByLabel("Instructions", { exact: true }).fill("Include exact fixture paths in the response.");
  await page.getByLabel("Reason for this revision", { exact: true }).fill("Verify a persisted edit after reload");
  await page.getByRole("button", { name: "Save profile", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Fixture reader", exact: true })).toBeVisible();
  store = await read(); profile = store.profiles.find(row => row.id === originalId);
  expect(profile.revision).toBe(2); expect(profile.history[0].config.instructions).toBe("Report the fixture files you inspect.");
  expect(profile.config.model).toEqual({ provider: "fixture-unconfigured", model: "fixture/reader" });
  expect((await call("/api/v1/agent-profiles", { action: "create", expectedRevision: store.revision, reason: "Rejected fixture policy", config: { ...profile.config, tools: ["exec_run"] } })).status).toBe(422);
  expect((await call("/api/v1/agent-profiles", { action: "move", expectedRevision: store.revision, reason: "Unsupported organization move" })).status).toBe(501);
  expect((await read()).revision).toBe(store.revision);

  await page.getByRole("button", { name: "Clone profile", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Fixture reader copy", exact: true })).toBeVisible();
  store = await read(); profile = store.profiles.find(row => row.config.name === "Fixture reader copy");
  expect(profile.clonedFrom).toEqual({ id: originalId, revision: 2 }); expect(store.defaultProfileId).toBe(originalId);
  const cloneId = profile.id;
  await page.getByRole("button", { name: "Set default", exact: true }).click();
  await expect(page.getByRole("button", { name: "Default profile", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Disable profile", exact: true }).click();
  await expect(page.getByRole("button", { name: "Enable profile", exact: true })).toBeVisible();
  expect((await read()).defaultProfileId).toBeNull();
  await page.getByRole("button", { name: "Enable profile", exact: true }).click();
  await expect(page.getByRole("button", { name: "Disable profile", exact: true })).toBeVisible();
  expect((await read()).defaultProfileId).toBeNull();
  await page.getByRole("button", { name: "Set default", exact: true }).click();
  await expect(page.getByRole("button", { name: "Default profile", exact: true })).toBeDisabled();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Fixture reader copy", exact: true })).toBeVisible();

  store = await read(); profile = store.profiles.find(row => row.id === cloneId);
  expect((await call("/api/v1/agent-profiles", { action: "edit", expectedRevision: store.revision, id: cloneId, profileRevision: profile.revision, reason: "Concurrent fixture edit", config: profile.config })).status).toBe(200);
  await page.getByRole("button", { name: "Edit profile", exact: true }).click();
  await page.getByLabel("Reason for this revision", { exact: true }).fill("Stale browser edit must not overwrite");
  await page.getByRole("button", { name: "Save profile", exact: true }).click();
  await expect(page.locator("form").filter({ has: page.getByRole("heading", { name: "Edit Fixture reader copy", exact: true }) }).getByRole("alert")).toContainText("changed in another tab");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByRole("button", { name: "Refresh", exact: true })).toBeEnabled();

  const task = page.getByRole("region", { name: "Run a read task", exact: true });
  await task.getByLabel("Task", { exact: true }).fill("Inspect the synthetic fixture.");
  const rejectedRun = page.waitForResponse(response => response.url().endsWith("/api/v1/agent-profiles/run") && response.request().method() === "POST");
  await task.getByRole("button", { name: "Run read task", exact: true }).click();
  expect((await rejectedRun).status()).toBe(501);
  await expect(task.getByRole("alert")).toHaveText("Connect fixture-unconfigured in Settings before running this profile.");
  expect(await page.evaluate(() => localStorage.getItem("alfa.agents"))).toBe(personas);
  const viewport = page.viewportSize();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  const accessibility = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(accessibility.violations.map(row => ({ id: row.id, targets: row.nodes.map(node => node.target) }))).toEqual([]);
  if (viewport) await page.setViewportSize(viewport);
  await fixture.setRole("operator");
  try { expect((await call("/api/v1/agent-profiles")).status).toBe(403); expect((await call("/api/v1/agent-profiles/run", {})).status).toBe(403); }
  finally { await fixture.setRole("owner"); }
  console.log("PASS synthetic saved-profile persistence, revision conflicts, clone/default lifecycle, read-only policy, missing connection, reflow and Owner boundary");
}
