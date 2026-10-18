import { expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const STAGES = [
  ["server", "Server", "Passed"],
  ["https", "HTTPS to configured origin", "Unknown"],
  ["mcp", "MCP endpoint", "Passed"],
  ["challenge", "OAuth challenge", "Passed"],
  ["resource", "Protected resource", "Passed"],
  ["oauth", "OAuth metadata", "Passed"],
  ["account", "Selected AI app account", "Unknown"],
  ["client-tools", "AI app tool cache", "Unknown"],
];

async function assertDiscovery(surface) {
  await expect(surface.getByText("Server discovery checks passed", { exact: true })).toBeVisible();
  const checks = surface.getByRole("list", { name: "Connection checks", exact: true });
  await expect(checks.getByRole("listitem")).toHaveCount(STAGES.length);
  for (const [id, label, state] of STAGES) {
    const row = checks.locator(`[data-probe-check="${id}"]`);
    await expect(row.getByText(label, { exact: true })).toBeVisible();
    await expect(row.getByText(state, { exact: true })).toBeVisible();
  }
}

async function definitions(surface) {
  return surface.locator("dl").evaluateAll(lists => Object.fromEntries(lists.flatMap(list =>
    Array.from(list.querySelectorAll("dt"), term => [term.textContent.trim(), term.nextElementSibling?.textContent.trim()]),
  )));
}

export async function mcpConnectionJourney(page, fixture, capture) {
  const endpoint = fixture.base + "/mcp";
  const response = await page.request.get(fixture.base + "/api/mcp/tokens");
  expect(response.status()).toBe(200);
  const { targetIdentity } = await response.json();
  expect(targetIdentity.hostname).toEqual(expect.any(String));
  expect(targetIdentity.hostname.length).toBeGreaterThan(0);
  expect(targetIdentity.environment).toBeNull();

  await page.getByRole("navigation", { name: "MCP navigation" })
    .getByRole("button", { name: /^Connection details/ }).click();
  const surface = page.locator('[data-slot="mcp-page"]');
  await assertDiscovery(surface);
  await expect(surface.getByRole("heading", { name: "Current server", exact: true })).toBeVisible();
  await expect.poll(() => definitions(surface)).toMatchObject({
    "Observed origin": fixture.base,
    "Configured MCP endpoint": endpoint,
    Hostname: targetIdentity.hostname,
    "Service user": targetIdentity.serviceUser ?? "Unavailable",
    "Runtime instance": targetIdentity.runtimeInstanceId ?? "Unavailable",
    Environment: "Not configured",
  });
  expect((await definitions(surface)).Checked).toBeTruthy();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  const accessibility = await new AxeBuilder({ page }).include('[data-slot="mcp-page"]')
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(accessibility.violations.map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) }))).toEqual([]);
  await capture(page, `mcp-connection-${page.viewportSize().width}`);

  let release = () => {};
  const held = new Promise(resolve => { release = resolve; });
  const failDiscovery = async route => {
    if (route.request().method() !== "GET") return route.continue();
    await held;
    await route.fulfill({ status: 503, contentType: "application/json", body: '{}' });
  };
  await page.route(endpoint, failDiscovery);
  try {
    const request = page.waitForRequest(req => req.url() === endpoint && req.method() === "GET");
    await surface.getByRole("button", { name: "Check connection", exact: true }).click();
    await request;
    await expect(surface.getByText("Checking this server…", { exact: true })).toBeVisible();
    await expect(surface.getByRole("button", { name: "Checking…", exact: true })).toBeDisabled();
    release();
    await expect(surface.getByText("Some server checks need attention", { exact: true })).toBeVisible();
    await expect(surface.locator('[data-probe-check="mcp"]').getByText("Failed", { exact: true })).toBeVisible();
    await expect(surface.getByText("Server discovery checks passed", { exact: true })).toHaveCount(0);
    for (const id of ["account", "client-tools"]) {
      await expect(surface.locator(`[data-probe-check="${id}"]`).getByText("Unknown", { exact: true })).toBeVisible();
    }
    await capture(page, `mcp-connection-failure-${page.viewportSize().width}`);
  } finally {
    release();
    await page.unroute(endpoint, failDiscovery);
  }
  await surface.getByRole("button", { name: "Check connection", exact: true }).click();
  await assertDiscovery(surface);
  await page.getByRole("navigation", { name: "Breadcrumb" }).getByRole("button", { name: "MCP", exact: true }).click();
  console.log(`PASS MCP connection stages, observed target and retry ${page.viewportSize().width}x${page.viewportSize().height}`);
}
