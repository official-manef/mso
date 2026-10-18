import type { WorkflowGraphNode } from "@/lib/contracts/workflow-graph";
import { normalizeWorkflowRunAt, parseWorkflowCron, validateWorkflowSchedule } from "@/lib/contracts/workflow-schedule";

function parts(date: Date, timeZone: string): number[] {
  const values = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, minute: "2-digit", hour: "2-digit", day: "2-digit", month: "2-digit", weekday: "short", hourCycle: "h23" }).formatToParts(date).map(part => [part.type, part.value]));
  return [Number(values.minute), Number(values.hour), Number(values.day), Number(values.month), ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(values.weekday)];
}

export function scheduleBucket(node: WorkflowGraphNode, now = new Date(), fallbackZone = "UTC"): string | null {
  if (node.type !== "schedule") return null;
  if (!Number.isFinite(now.getTime())) throw new Error("invalid scheduler clock");
  const config = node.config, mode = validateWorkflowSchedule(config, fallbackZone);
  const zone = typeof config.timezone === "string" && config.timezone ? config.timezone : fallbackZone;
  if (mode === "runAt") {
    const instant = normalizeWorkflowRunAt(config.runAt);
    return now.getTime() >= Date.parse(instant) ? `runAt:${instant}` : null;
  }
  const minute = Math.floor(now.getTime() / 60000);
  if (mode === "interval") return minute % Number(config.everyMinutes ?? 60) === 0 ? `${zone}:${minute}` : null;
  const cron = String(config.cron), fields = parseWorkflowCron(cron), local = parts(now, zone);
  const matches = fields.map((field, index) => field.includes(local[index]));
  const tokens = cron.trim().split(/\s+/), restrictedDays = !tokens[2].startsWith("*") && !tokens[4].startsWith("*");
  // Legacy graphs retain AND. New editor configs explicitly choose conventional OR.
  const day = config.dayMatch === "or" && restrictedDays ? matches[2] || matches[4] : matches[2] && matches[4];
  return matches[0] && matches[1] && matches[3] && day ? `${zone}:${minute}` : null;
}
