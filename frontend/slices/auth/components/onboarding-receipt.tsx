"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { firstCheckComplete, onboardingError, readFirstCheckReceipt, runFirstCheck, type FirstCheckReceipt } from "../lib/onboarding-api";
import type { OnboardingProgress } from "../lib/onboarding-state";
import { OnboardingValue } from "./onboarding-readiness";

export function OnboardingReceipt({ progress, onProgress, onWorkflows }: { progress: OnboardingProgress; onProgress: (value: OnboardingProgress) => void; onWorkflows: () => void }) {
  const [run, setRun] = useState<FirstCheckReceipt | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const alive = useRef(true);
  const [refresh, setRefresh] = useState(0);
  const runId = progress.attempt?.runId;

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!runId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const started = Date.now();
    async function poll() {
      try {
        const next = await readFirstCheckReceipt(runId!, controller.signal);
        if (controller.signal.aborted) return;
        setRun(next);
        setError("");
        if (next.state === "running" && Date.now() - started < 30_000) timer = setTimeout(() => void poll(), 1500);
      } catch (cause) { if (!controller.signal.aborted) setError(onboardingError(cause)); }
    }
    void poll();
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [runId, refresh]);

  async function start() {
    if (inFlight.current || !progress.project) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    const next: OnboardingProgress = {
      ...progress,
      attempt: progress.attempt && (!run || run.state === "running" || run.state === "completed")
        ? progress.attempt : { graphId: progress.attempt?.graphId ?? crypto.randomUUID(), key: `onboarding:${crypto.randomUUID()}` },
    };
    // Persist the request identity before dispatch so a lost response can be reconciled.
    onProgress(next);
    try {
      const result = await runFirstCheck(next);
      if (alive.current) {
        setRun(result);
        onProgress({ ...next, attempt: { ...next.attempt!, runId: result.id } });
      }
    } catch (cause) {
      if (alive.current) setError(onboardingError(cause));
    } finally {
      inFlight.current = false;
      if (alive.current) setBusy(false);
    }
  }

  const complete = firstCheckComplete(run, progress);
  const inspection = run?.nodes.find((node) => node.id === "inspect")?.output as { project?: { name?: string; path?: string }; git?: { available?: boolean; branch?: string; clean?: boolean }; package?: { name?: string; version?: string } } | undefined;
  return <section className="space-y-4" aria-labelledby="onboarding-receipt">
    <div className="space-y-2">
      <h3 id="onboarding-receipt" className="font-semibold">Run a first project check</h3>
      <p className="text-sm text-muted-foreground">MSO saves a manual workflow, resolves <strong>{progress.project?.name || "the selected project"}</strong>, reads its status and records a run receipt. This check changes no project files and makes no model request.</p>
    </div>
    {!progress.project ? <p className="text-sm">Choose a project in the previous step before running a check.</p> : null}
    <div className="flex flex-wrap gap-2">
      {!runId || (run && !["running", "completed"].includes(run.state)) ? <Button className="min-h-11" onClick={() => void start()} disabled={!progress.project || busy}>{busy ? "Starting project check…" : progress.attempt && !run ? "Check previous request" : run ? "Run the check again" : "Run project check"}</Button> : null}
      {runId ? <Button variant="outline" className="min-h-11" disabled={busy} onClick={() => setRefresh((value) => value + 1)}>Refresh receipt</Button> : null}
      {progress.attempt ? <Button variant="outline" className="min-h-11" onClick={onWorkflows}>Open Workflows</Button> : null}
    </div>
    {runId && !run && !error ? <p role="status" className="text-sm">Loading the saved run receipt…</p> : null}
    {error ? <p role="alert" className="text-sm text-destructive">{error} The check is not marked complete. Recheck the existing request or open Workflows to inspect its result.</p> : null}
    {run ? <div className="space-y-3">
      <p role="status" className="text-sm font-medium">{complete ? "Project check completed with a saved receipt." : run.state === "running" ? "The server is still running the check. Refresh its receipt if needed." : `Run status: ${run.state}. Review the steps below.`}</p>
      <dl className="space-y-2 rounded-lg border bg-muted/30 p-3 text-sm">
        <OnboardingValue label="Workflow" value={run.graphName} />
        <OnboardingValue label="Started" value={new Date(run.startedAt).toLocaleString()} />
        {run.finishedAt ? <OnboardingValue label="Finished" value={new Date(run.finishedAt).toLocaleString()} /> : null}
        {inspection?.project?.path ? <OnboardingValue label="Project path" value={inspection.project.path} /> : null}
        {inspection?.git?.available ? <><OnboardingValue label="Git branch" value={inspection.git.branch || "Not reported"} /><OnboardingValue label="Working tree" value={inspection.git.clean === true ? "Clean" : inspection.git.clean === false ? "Has local changes" : "Not reported"} /></> : null}
      </dl>
      <ol className="space-y-2 text-sm">{run.nodes.map((node) => <li key={node.id} className="[overflow-wrap:anywhere]"><span className="font-medium">{node.name}</span>: {node.state}{node.error ? <p className="text-destructive">{node.error}</p> : null}</li>)}</ol>
      <details className="text-xs text-muted-foreground"><summary className="min-h-11 cursor-pointer py-3">Receipt reference</summary><p className="[overflow-wrap:anywhere]">{run.id}</p></details>
    </div> : null}
    <p className="text-xs text-muted-foreground">Run evidence stays in Workflows on the server. Closing this guide does not stop an active check. Model and tool-call readiness require their own verification.</p>
  </section>;
}
