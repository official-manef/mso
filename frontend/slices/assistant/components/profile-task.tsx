"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { AgentProfile, AgentProfileRunResult } from "@/lib/contracts/agent-profile";
import { profileResponse } from "../lib/profile-errors";

export function ProfileTask({ profile }: { profile: AgentProfile }) {
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AgentProfileRunResult | null>(null);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const run = async (event: React.FormEvent) => {
    event.preventDefault();
    const abort = new AbortController(); controller.current = abort;
    setBusy(true); setError(""); setResult(null);
    try {
      const response = await fetch("/api/v1/agent-profiles/run", { method: "POST", headers: { "Content-Type": "application/json" }, signal: abort.signal,
        body: JSON.stringify({ profileId: profile.id, profileRevision: profile.revision, prompt }) });
      setResult(await profileResponse<AgentProfileRunResult>(response));
    } catch (cause) { setError(abort.signal.aborted ? "Stopped. Completed reads remain in the run session." : cause instanceof Error ? cause.message : "The task failed."); }
    finally { setBusy(false); controller.current = null; }
  };
  return <section className="space-y-3 border-t border-border pt-4" aria-labelledby="profile-task-heading">
    <h3 id="profile-task-heading" className="font-semibold">Run a read task</h3>
    <p className="text-sm text-muted-foreground">{profile.config.name}, revision {profile.revision}, uses {profile.config.model.provider}/{profile.config.model.model}. Each task starts a new session without earlier chat or memory.</p>
    <form onSubmit={(event) => void run(event)} className="space-y-3">
      <label className="block space-y-1 text-sm">Task<Textarea required maxLength={8000} value={prompt} disabled={busy || !profile.enabled} onChange={(event) => setPrompt(event.target.value)} placeholder="Describe what to inspect or explain." className="min-h-24" /></label>
      <div className="flex flex-wrap items-center gap-3">
        <Button className="min-h-11" disabled={busy || !profile.enabled || !prompt.trim()}>{busy ? "Running…" : "Run read task"}</Button>
        {busy && <Button className="min-h-11" type="button" variant="outline" onClick={() => controller.current?.abort()}>Stop task</Button>}
        {busy && <span role="status" className="text-sm text-muted-foreground">Reading with the saved profile. Maximum one minute.</span>}
      </div>
    </form>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {result && <div className="space-y-3 rounded-md bg-muted p-4">
      <p className="text-sm font-medium">{result.status === "completed" ? "Completed" : "Stopped at the configured limit"} · {result.rounds} model turns</p>
      <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">{result.text || "The provider returned no text."}</div>
      {result.toolCalls.length > 0 && <ul className="space-y-1 text-xs">{result.toolCalls.map((call, index) => <li key={index}>{call.name}: {call.ok ? "completed" : "denied or failed"}</li>)}</ul>}
      <p className="break-all text-xs text-muted-foreground">Run session: {result.runId}. The session and tool receipts are available in Sessions.</p>
    </div>}
  </section>;
}
