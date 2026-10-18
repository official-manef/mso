import { describe, expect, it } from "vitest";
import { normalizeWorkflowRunAt, parseWorkflowCron, validateWorkflowSchedule, validateWorkflowTimezone } from "./workflow-schedule";

describe("workflow schedule input contract", () => {
  it("normalizes explicit offsets without changing the saved input", () => {
    const config = { mode: "runAt", runAt: "2026-10-19T09:00:30+07:00", missedPolicy: "run_once" };
    expect(validateWorkflowSchedule(config)).toBe("runAt");
    expect(normalizeWorkflowRunAt(config.runAt)).toBe("2026-10-19T02:00:30.000Z");
    expect(config.runAt).toBe("2026-10-19T09:00:30+07:00");
    expect(normalizeWorkflowRunAt("2026-10-18T22:00:30-04:00")).toBe(normalizeWorkflowRunAt(config.runAt));
    expect(normalizeWorkflowRunAt("2024-02-29T00:00:00.123Z")).toBe("2024-02-29T00:00:00.123Z");
  });
  it.each([undefined, null, 0, "", "2026-10-19", "2026-10-19T09:00:30", "2026-02-29T00:00:00Z", "2026-04-31T00:00:00Z", "2026-13-01T00:00:00Z", "2026-01-00T00:00:00Z", "2026-10-19T24:00:00Z", "2026-10-19T09:60:00Z", "2026-10-19T09:00:60Z", "2026-10-19T09:00:00+24:00", "2026-10-19T09:00:00+07:60", "2026-10-19T09:00:00.1234Z"])("rejects ambiguous or invalid instant %s", value => {
    expect(() => normalizeWorkflowRunAt(value)).toThrow(/runAt/);
  });
  it.each([null, 7, "Mars/Olympus", " UTC", "+07:00"])("rejects invalid IANA timezone %s", value => expect(() => validateWorkflowTimezone(value)).toThrow(/timezone/));
  it.each(["0001-01-01T00:00:00+23:59", "9999-12-31T23:59:59-23:59"])("rejects offsets outside the stored UTC year range: %s", value => expect(() => normalizeWorkflowRunAt(value)).toThrow(/runAt/));
  it("accepts valid timezone aliases and an explicitly inherited empty override", () => {
    expect(validateWorkflowTimezone("UTC")).toBe("UTC"); expect(validateWorkflowTimezone("Asia/Jakarta")).toBe("Asia/Jakarta");
    expect(validateWorkflowSchedule({ mode: "interval", everyMinutes: 5, timezone: "" }, "Asia/Jakarta")).toBe("interval");
  });
  it.each([
    { mode: "once" }, { mode: null }, { mode: 0 }, { mode: "interval", everyMinutes: 0 }, { mode: "interval", everyMinutes: 10081 },
    { mode: "interval", everyMinutes: 1.5 }, { mode: "interval", everyMinutes: "5" }, { mode: "interval", everyMinutes: null },
    { mode: "interval", runAt: "2026-10-19T02:00:30Z" }, { mode: "cron", cron: "* * * * *", runAt: "2026-10-19T02:00:30Z" },
    { mode: "cron", cron: "* * * * *", dayMatch: "either" }, { mode: "cron", cron: "* * * * *", missedPolicy: "run_once" },
    { mode: "runAt", runAt: "2026-10-19T02:00:30Z" }, { mode: "runAt", runAt: "2026-10-19T02:00:30Z", missedPolicy: "skip" },
    { mode: "runAt", runAt: "2026-10-19T02:00:30Z", missedPolicy: "run_once", cron: "* * * * *" },
  ])("rejects invalid or mixed mode config %j", config => expect(() => validateWorkflowSchedule(config)).toThrow());
  it.each([
    { mode: "interval", everyMinutes: 60, cron: "unused legacy text", dayMatch: "unused" },
    { mode: "cron", cron: "30 12 * * *", everyMinutes: "unused legacy text" },
  ])("keeps legacy inactive recurring fields inert for $mode", config => {
    const original = structuredClone(config); expect(validateWorkflowSchedule(config)).toBe(config.mode); expect(config).toEqual(original);
  });
  it.each(["* * *", "* * * * * *", "* * * * 7", "* * 32 * *", "* 24 * * *", "* * * 13 *", "0,,1 * * * *", "*/0 * * * *", "1-0 * * * *", "*/2/3 * * * *", "* * * * MON"])("validates every cron field in %s", expression => expect(() => parseWorkflowCron(expression)).toThrow());
  it("supports bounded numeric lists, ranges and steps", () => {
    const fields = parseWorkflowCron("0,15-45/15 9-17 * * 1-5");
    expect(fields[0]).toEqual([0, 15, 30, 45]); expect(fields[1]).toHaveLength(9); expect(fields[4]).toEqual([1, 2, 3, 4, 5]);
  });
});
