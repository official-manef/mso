"use client";
import { useId } from "react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { normalizeWorkflowRunAt, validateWorkflowSchedule } from "@/lib/contracts/workflow-schedule";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1"><span className="text-muted-foreground">{label}</span>{children}</div>;
}
function Choice({ label, value, options, onChange }: { label: string; value: string; options: Array<[string, string]>; onChange: (value: string) => void }) {
  return <Field label={label}><Select value={value} onValueChange={onChange}><SelectTrigger aria-label={label} className="w-full"><SelectValue /></SelectTrigger><SelectContent>{options.map(([key, text]) => <SelectItem key={key} value={key}>{text}</SelectItem>)}</SelectContent></Select></Field>;
}

export function WorkflowScheduleFields({ config, timezone, onChange }: { config: Record<string, unknown>; timezone: string; onChange: (config: Record<string, unknown>) => void }) {
  const errorId = useId(), mode = String(config.mode ?? "interval");
  const set = (key: string, value: unknown) => onChange({ ...config, [key]: value });
  let error = "", normalized = "";
  try { validateWorkflowSchedule(config, timezone); } catch (cause) { error = cause instanceof Error ? cause.message : "Invalid schedule"; }
  if (mode === "runAt") try { normalized = normalizeWorkflowRunAt(config.runAt); } catch {}
  const changeMode = (value: string) => {
    const next: Record<string, unknown> = { ...config, mode: value };
    for (const field of ["everyMinutes", "cron", "dayMatch", "runAt", "missedPolicy"]) delete next[field];
    Object.assign(next, value === "interval" ? { everyMinutes: 60 } : value === "cron" ? { cron: "0 * * * *", dayMatch: "or" } : { runAt: "", missedPolicy: "run_once" });
    onChange(next);
  };
  return <>
    <Choice label="Schedule mode" value={mode} onChange={changeMode} options={[["interval", "Interval"], ["cron", "Cron"], ["runAt", "Once at a date and time"]]} />
    {mode === "interval" && <Field label="Every minutes"><Input aria-label="Every minutes" type="number" min={1} max={10080} required value={String(config.everyMinutes ?? 60)} onChange={event => set("everyMinutes", Number(event.target.value))} /></Field>}
    {mode === "cron" && <>
      <Field label="Cron (minute hour day month weekday)"><Input aria-label="Cron (minute hour day month weekday)" required value={String(config.cron ?? "")} onChange={event => set("cron", event.target.value)} /></Field>
      <Choice label="When both day fields are restricted" value={String(config.dayMatch ?? "and")} onChange={value => set("dayMatch", value)} options={[["or", "Either day field matches"], ["and", "Both day fields match (legacy)"]]} />
    </>}
    {mode === "runAt" && <>
      <Field label="Run at (date, time and UTC offset)"><Input aria-label="Run at (date, time and UTC offset)" required aria-invalid={!normalized} aria-describedby={error ? errorId : undefined} placeholder="2026-11-01T09:00:00+07:00" value={String(config.runAt ?? "")} onChange={event => set("runAt", event.target.value)} /></Field>
      {normalized && <p className="break-all text-muted-foreground">UTC: <time dateTime={normalized}>{normalized}</time></p>}
      <p className="text-muted-foreground">If this time has passed, run once on the next active scheduler tick. The UTC offset fixes the instant; the timezone below does not move it.</p>
    </>}
    <Field label="Timezone override"><Input aria-label="Timezone override" value={String(config.timezone ?? "")} placeholder={timezone} onChange={event => { const next = { ...config }; if (event.target.value) next.timezone = event.target.value; else delete next.timezone; onChange(next); }} /></Field>
    {error && <p id={errorId} role="alert" className="text-destructive">{error}</p>}
  </>;
}
