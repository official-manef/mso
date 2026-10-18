import { expect } from "@playwright/test";

async function api(page, query = "", body) {
  return page.evaluate(async ({ query, body }) => {
    const response = await fetch(`/api/v1/workflows${query ? `?${query}` : ""}`, {
      ...(body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(5000),
    });
    return { status: response.status, body: await response.json() };
  }, { query, body });
}
const offsetTime = instant => new Date(instant + 7 * 3600_000).toISOString().replace(/Z$/, "+07:00");

export async function workflowSchedulesJourney(page, fixture) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(fixture.base + "/workflows");
  const name = `E2E Schedule ${Date.now()}`, output = { schedule: "one-shot browser receipt" };
  const created = await api(page, "", { action: "create", graph: {
    name, description: "Schedule editor and output-only runtime", status: "draft", inputs: {},
    metadata: { provenance: "user", timezone: "UTC" },
    nodes: [
      { id: "schedule", name: "Schedule Trigger", type: "schedule", position: { x: 80, y: 160 }, config: { mode: "interval", everyMinutes: 60 } },
      { id: "output", name: "Schedule Output", type: "output", position: { x: 420, y: 160 }, config: { value: output } },
    ],
    edges: [{ id: "schedule-output", source: "schedule", target: "output" }],
  } });
  expect(created.status).toBe(200);
  const graphId = created.body.graph.id, query = `graph_id=${encodeURIComponent(graphId)}`;
  const feature = page.locator('[data-slot="workflows-feature"]').last();
  const openSchedule = () => feature.locator('.react-flow__node[data-id="schedule"]').click();
  const closeDrawer = async () => { if (await page.getByRole("dialog").count()) await page.keyboard.press("Escape"); };
  const choose = async (label, option) => {
    await page.getByRole("combobox", { name: label, exact: true }).click();
    await page.getByRole("option", { name: option, exact: true }).click();
  };
  const persisted = async () => {
    const response = await api(page, query); expect(response.status).toBe(200); return response.body.graph;
  };
  const runs = async () => {
    const response = await api(page, `runs=1&${query}`); expect(response.status).toBe(200); return response.body.runs;
  };
  const config = graph => graph.nodes.find(node => node.id === "schedule").config;
  const reload = async () => {
    await page.reload();
    await expect(feature.getByLabel("Workflow name")).toBeVisible();
    const entry = page.getByRole("button", { name: new RegExp(`^${name}\\b`) });
    if (!await entry.isVisible()) await feature.getByRole("button", { name: "Workflow library", exact: true }).click();
    await entry.click();
    await expect(feature.getByLabel("Workflow name")).toHaveValue(name);
    await openSchedule();
  };
  const save = async (status = 200) => {
    await closeDrawer();
    const pending = page.waitForResponse(response => new URL(response.url()).pathname === "/api/v1/workflows" &&
      response.request().method() === "POST" && response.request().postDataJSON()?.action === "update" &&
      response.request().postDataJSON()?.graph_id === graphId);
    await feature.getByRole("button", { name: "Save", exact: true }).click();
    const response = await pending; expect(response.status()).toBe(status);
    if (status === 200) await expect(feature.getByText("Unsaved", { exact: true })).toBeHidden();
    return response.json();
  };

  try {
    await reload();
    await expect(page.getByLabel("Every minutes", { exact: true })).toHaveValue("60");
    await choose("Schedule mode", "Cron");
    await expect(page.getByLabel("When both day fields are restricted")).toHaveText("Either day field matches");
    await page.getByLabel("Cron (minute hour day month weekday)").fill("0 9 1 * 1");
    await page.getByLabel("Timezone override", { exact: true }).fill("Asia/Jakarta");
    await save();
    expect(config(await persisted())).toEqual({ mode: "cron", cron: "0 9 1 * 1", dayMatch: "or", timezone: "Asia/Jakarta" });

    await openSchedule();
    await choose("Schedule mode", "Interval");
    await page.getByLabel("Every minutes", { exact: true }).fill("7");
    await save();
    const beforeInvalid = await persisted();
    expect(config(beforeInvalid)).toEqual({ mode: "interval", everyMinutes: 7, timezone: "Asia/Jakarta" });

    await openSchedule();
    await choose("Schedule mode", "Once at a date and time");
    const runAt = page.getByLabel("Run at (date, time and UTC offset)", { exact: true });
    await expect(runAt).toHaveAttribute("required", "");
    await runAt.fill("2026-11-01T09:00:00");
    await expect(runAt).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByRole("alert").filter({ hasText: /runAt.*explicit UTC offset/ })).toBeVisible();
    expect((await save(400)).error).toMatch(/runAt.*explicit UTC offset/);
    expect((await persisted()).revision).toBe(beforeInvalid.revision);

    await openSchedule();
    const future = offsetTime(Date.now() + 3600_000), futureUtc = new Date(future).toISOString();
    await runAt.fill(future);
    await expect(runAt).toHaveAttribute("aria-invalid", "false");
    await expect(page.locator(`time[datetime="${futureUtc}"]`)).toHaveText(futureUtc);
    await save();
    expect(config(await persisted())).toEqual({ mode: "runAt", runAt: future, missedPolicy: "run_once", timezone: "Asia/Jakarta" });
    await reload();
    await expect(runAt).toHaveValue(future);
    await expect(page.getByLabel("Timezone override", { exact: true })).toHaveValue("Asia/Jakarta");
    await expect(page.getByLabel("Schedule mode", { exact: true })).toHaveText("Once at a date and time");
    await expect(page.locator(`time[datetime="${futureUtc}"]`)).toHaveText(futureUtc);
    expect(await runs()).toEqual([]);

    // An overdue instant exercises the documented next-active-tick policy on the real server timer.
    const due = offsetTime(Date.now() - 1000), dueUtc = new Date(due).toISOString();
    await runAt.fill(due);
    await closeDrawer();
    await feature.getByLabel("Workflow status").selectOption("active");
    await save();
    const active = await persisted(); expect(active.status).toBe("active");
    await expect.poll(async () => (await runs())[0]?.state, { timeout: 35000, intervals: [500, 1000] }).toBe("completed");
    const completed = await runs(); expect(completed).toHaveLength(1);
    const result = await api(page, `run_id=${encodeURIComponent(completed[0].id)}`);
    expect(result.status).toBe(200);
    expect(result.body.graphRevision).toBe(active.revision);
    expect(result.body.trigger).toMatchObject({ type: "schedule", scheduleMode: "runAt", nodeId: "schedule", scheduledAt: dueUtc });
    expect(result.body.nodes.find(node => node.id === "output")).toMatchObject({ state: "completed", output });

    await openSchedule();
    await runAt.fill(dueUtc);
    await page.getByLabel("Timezone override", { exact: true }).fill("UTC");
    await save();
    expect(config(await persisted())).toEqual({ mode: "runAt", runAt: dueUtc, missedPolicy: "run_once", timezone: "UTC" });
    await reload();
    await expect(runAt).toHaveValue(dueUtc);
    const observeUntil = Date.now() + 16000;
    await expect.poll(async () => {
      expect((await runs()).map(run => run.id)).toEqual([completed[0].id]);
      return Date.now() >= observeUntil;
    }, { timeout: 20000, intervals: [1000] }).toBe(true);
  } finally {
    const current = await persisted();
    const removed = await api(page, "", { action: "delete", graph_id: graphId, expected_revision: current.revision });
    expect(removed.status).toBe(200);
  }
  console.log("PASS Workflow schedule mode switching, invalid-save rejection, offset normalization, persistence/reload, real overdue one-shot receipt and repeated-tick identity");
}
