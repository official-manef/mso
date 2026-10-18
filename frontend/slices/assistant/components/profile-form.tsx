"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { AgentProfile, AgentProfileCatalog, AgentProfileConfig } from "@/lib/contracts/agent-profile";

export function ProfileForm({ profile, catalog, onSave, onCancel }: {
  profile?: AgentProfile;
  catalog: AgentProfileCatalog;
  onSave: (config: AgentProfileConfig, reason: string) => Promise<void>;
  onCancel: () => void;
}) {
  const instructionsId = useId();
  const [config, setConfig] = useState<AgentProfileConfig>(profile?.config ?? {
    name: "", avatar: "", instructions: "", runtime: "mso-readonly", model: catalog.selectedModel, tools: [],
  });
  const [reason, setReason] = useState(profile ? "" : "Create saved profile");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError("");
    try { await onSave(config, reason); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save profile."); }
    finally { setBusy(false); }
  };
  return <form onSubmit={(event) => void save(event)} className="space-y-5 rounded-lg border border-border bg-card p-4">
    <h2 className="text-lg font-semibold">{profile ? `Edit ${profile.config.name}` : "Create saved profile"}</h2>
    <div className="grid gap-4 @md:grid-cols-[1fr_6rem]">
      <label className="space-y-1 text-sm">Name<Input required maxLength={80} value={config.name} onChange={(event) => setConfig({ ...config, name: event.target.value })} /></label>
      <label className="space-y-1 text-sm">Initials<Input maxLength={8} value={config.avatar} onChange={(event) => setConfig({ ...config, avatar: event.target.value })} placeholder="Optional" /></label>
    </div>
    <div className="space-y-1 text-sm"><label htmlFor={instructionsId}>Instructions</label><Textarea id={instructionsId} maxLength={4000} value={config.instructions} onChange={(event) => setConfig({ ...config, instructions: event.target.value })} placeholder="Describe the work and response style for this profile." className="min-h-28" /></div>
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium">Model connection</legend>
      <p className="text-xs text-muted-foreground">Uses the exact provider and model configured in Settings. Credentials stay in that connection.</p>
      <div className="grid gap-3 @lg:grid-cols-2">
        <label className="space-y-1 text-sm">Provider ID<Input required maxLength={64} value={config.model.provider} onChange={(event) => setConfig({ ...config, model: { ...config.model, provider: event.target.value } })} /></label>
        <label className="space-y-1 text-sm">Model ID<Input required maxLength={200} value={config.model.model} onChange={(event) => setConfig({ ...config, model: { ...config.model, model: event.target.value } })} /></label>
      </div>
    </fieldset>
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">Allowed read tools</legend>
      <p className="text-xs text-muted-foreground">Only selected tools can run. With none selected, the profile answers from its instructions and the task text.</p>
      {catalog.tools.map(tool => <label key={tool.name} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-md px-2 py-2 hover:bg-muted">
        <Input type="checkbox" className="mt-0.5 size-4 shrink-0" checked={config.tools.includes(tool.name)} onChange={(event) => setConfig({ ...config, tools: event.target.checked ? [...config.tools, tool.name] : config.tools.filter(name => name !== tool.name) })} />
        <span className="min-w-0 text-sm"><span className="break-all font-medium">{tool.name}</span><span className="mt-0.5 block text-xs text-muted-foreground">{tool.description}</span></span>
      </label>)}
    </fieldset>
    <label className="block space-y-1 text-sm">Reason for this revision<Input required maxLength={400} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="What changed and why?" /></label>
    <p className="text-xs text-muted-foreground">Runtime: MSO read task. Write tools, external runtimes, organization moves, and memory or skill assignment are not available in this version.</p>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="flex flex-wrap gap-2"><Button className="min-h-11" type="submit" disabled={busy || !config.name.trim() || !reason.trim()}>{busy ? "Saving…" : "Save profile"}</Button><Button className="min-h-11" type="button" variant="outline" onClick={onCancel} disabled={busy}>Cancel</Button></div>
  </form>;
}
