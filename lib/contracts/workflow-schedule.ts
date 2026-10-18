export type WorkflowScheduleMode = "interval" | "cron" | "runAt";

export function validateWorkflowTimezone(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z][A-Za-z0-9_+./-]{0,99}$/.test(value)) throw new Error("schedule timezone must be an IANA timezone");
  try { new Intl.DateTimeFormat("en-US", { timeZone: value }).format(0); }
  catch { throw new Error("schedule timezone must be an IANA timezone"); }
  return value;
}

export function normalizeWorkflowRunAt(value: unknown): string {
  const match = typeof value === "string" && /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) throw new Error("runAt requires a date and time with an explicit UTC offset");
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const calendar = new Date(0); calendar.setUTCFullYear(year, month - 1, day);
  const offset = match[8], offsetHour = offset === "Z" ? 0 : Number(offset.slice(1, 3)), offsetMinute = offset === "Z" ? 0 : Number(offset.slice(4, 6));
  if (year < 1 || calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 || calendar.getUTCDate() !== day || hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59) throw new Error("runAt contains an invalid date, time or UTC offset");
  const instant = new Date(value as string);
  if (!Number.isFinite(instant.getTime()) || instant.getUTCFullYear() < 1 || instant.getUTCFullYear() > 9999) throw new Error("runAt contains an invalid date, time or UTC offset");
  return instant.toISOString();
}

export function parseWorkflowCron(value: unknown): number[][] {
  if (typeof value !== "string" || value.length > 256) throw new Error("cron requires 5 fields: minute hour day month weekday");
  const fields = value.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error("cron requires 5 fields: minute hour day month weekday");
  return fields.map((field, index) => {
    const [minimum, maximum] = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 6]][index], values = new Set<number>();
    for (const token of field.split(",")) {
      const match = /^(\*|\d+(?:-\d+)?)(?:\/([1-9]\d*))?$/.exec(token);
      if (!match) throw new Error("invalid cron field");
      const range = match[1], step = Number(match[2] ?? 1);
      const [low, high] = range === "*" ? [minimum, maximum] : range.includes("-") ? range.split("-").map(Number) : [Number(range), Number(range)];
      if (!Number.isSafeInteger(step) || !Number.isSafeInteger(low) || !Number.isSafeInteger(high) || low < minimum || high > maximum || low > high) throw new Error("invalid cron field");
      for (let number = low; number <= high; number += step) values.add(number);
    }
    return [...values];
  });
}

export function validateWorkflowSchedule(config: Record<string, unknown>, fallbackTimezone = "UTC"): WorkflowScheduleMode {
  const mode = config.mode === undefined ? "interval" : config.mode;
  if (!["interval", "cron", "runAt"].includes(String(mode)) || typeof mode !== "string") throw new Error("invalid schedule mode");
  validateWorkflowTimezone(config.timezone === undefined || config.timezone === "" ? fallbackTimezone : config.timezone);
  // The previous editor retained inactive interval/cron fields when switching modes.
  const fields = { interval: ["runAt", "missedPolicy"], cron: ["runAt", "missedPolicy"], runAt: ["everyMinutes", "cron", "dayMatch"] };
  for (const field of fields[mode as WorkflowScheduleMode]) if (config[field] !== undefined) throw new Error(`${field} is not supported for schedule mode ${mode}`);
  if (mode === "interval") {
    const every = config.everyMinutes === undefined ? 60 : config.everyMinutes;
    if (typeof every !== "number" || !Number.isInteger(every) || every < 1 || every > 10080) throw new Error("everyMinutes must be an integer from 1 to 10080");
  } else if (mode === "cron") {
    parseWorkflowCron(config.cron);
    if (config.dayMatch !== undefined && config.dayMatch !== "and" && config.dayMatch !== "or") throw new Error("cron dayMatch must be and or or");
  } else {
    normalizeWorkflowRunAt(config.runAt);
    if (config.missedPolicy !== "run_once") throw new Error("runAt requires missedPolicy run_once");
  }
  return mode as WorkflowScheduleMode;
}
