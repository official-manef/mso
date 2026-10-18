"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import type { AgentProfile, AgentProfileCatalog, AgentProfileConfig, AgentProfileStore } from "@/lib/contracts/agent-profile";
import { profileResponse } from "../lib/profile-errors";
import { ProfileForm } from "./profile-form";
import { ProfileTask } from "./profile-task";

export function ProfilesPanel() {
  const [catalog, setCatalog] = useState<AgentProfileCatalog | null>(null);
  const [selected, setSelected] = useState("");
  const [editing, setEditing] = useState<{ profile?: AgentProfile } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reload, setReload] = useState(0);
  const refresh = () => { setLoading(true); setError(""); setReload(value => value + 1); };
  useEffect(() => {
    const abort = new AbortController();
    void fetch("/api/v1/agent-profiles", { cache: "no-store", signal: abort.signal })
      .then(response => profileResponse<AgentProfileCatalog>(response))
      .then(data => {
        if (abort.signal.aborted) return;
        setCatalog(data); setSelected(current => data.store.profiles.some(profile => profile.id === current) ? current : data.store.defaultProfileId ?? data.store.profiles[0]?.id ?? "");
      })
      .catch(cause => { if (!abort.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load profiles."); })
      .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [reload]);

  const mutate = async (action: string, profile?: AgentProfile, extra: Record<string, unknown> = {}) => {
    if (!catalog) return;
    const data = await profileResponse<{ store: AgentProfileStore }>(await fetch("/api/v1/agent-profiles", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, expectedRevision: catalog.store.revision, ...(profile ? { id: profile.id, profileRevision: profile.revision } : {}), reason: `${action} saved profile`, ...extra }),
    }));
    setCatalog({ ...catalog, store: data.store });
    if (action === "create" || action === "clone") setSelected(data.store.profiles.at(-1)?.id ?? "");
    setNotice("Saved on the server.");
  };
  const act = async (action: string, profile: AgentProfile) => {
    setBusy(true); setError(""); setNotice("");
    try { await mutate(action, profile, action === "clone" ? { name: `${profile.config.name.slice(0, 74)} copy` } : {}); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The profile could not be updated."); }
    finally { setBusy(false); }
  };
  const save = async (config: AgentProfileConfig, reason: string) => {
    await mutate(editing?.profile ? "edit" : "create", editing?.profile, { config, reason });
    setEditing(null);
  };
  const profile = catalog?.store.profiles.find(row => row.id === selected);

  return <div className="@container space-y-5 p-4 [padding-bottom:calc(1rem+var(--sai-bottom))]">
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-lg font-semibold">Saved agent profiles</h1><p className="mt-1 max-w-prose text-sm text-muted-foreground">Profiles and revisions are saved for this Owner device. Select a profile to inspect its configuration or run a read task.</p></div>
      <div className="flex flex-wrap gap-2"><Button className="min-h-11" variant="outline" disabled={loading || busy} onClick={() => void refresh()}>{loading ? "Loading…" : "Refresh"}</Button><Button className="min-h-11" disabled={!catalog || busy} onClick={() => { setEditing({}); setNotice(""); }}>New saved profile</Button></div>
    </header>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
    {loading && !catalog && <p role="status" className="text-sm text-muted-foreground">Loading saved profiles…</p>}
    {editing && catalog ? <ProfileForm key={editing.profile?.id ?? "new"} profile={editing.profile} catalog={catalog} onSave={save} onCancel={() => setEditing(null)} /> : catalog && <>
      {!catalog.store.profiles.length ? <div className="rounded-lg border border-border bg-card p-6"><h2 className="font-medium">No saved profiles yet</h2><p className="mt-2 text-sm text-muted-foreground">Create a profile, choose its exact model, and select the read tools it may use. Browser personas are available in the other tab.</p></div> : <div className="grid min-w-0 gap-5 @xl:grid-cols-[minmax(10rem,1fr)_minmax(0,3fr)]">
        <nav aria-label="Saved profiles" className="flex min-w-0 flex-col gap-1">
          {catalog.store.profiles.map(row => <Button key={row.id} variant={row.id === selected ? "secondary" : "ghost"} className="h-auto min-h-11 justify-start whitespace-normal text-left" onClick={() => { setSelected(row.id); setNotice(""); }}>
            <span className="min-w-0 break-words">{row.config.avatar ? `${row.config.avatar} ` : ""}{row.config.name}<span className="block text-xs font-normal text-muted-foreground">Revision {row.revision}{catalog.store.defaultProfileId === row.id ? " · Default" : ""}{!row.enabled ? " · Disabled" : ""}</span></span>
          </Button>)}
        </nav>
        {profile && <section className="min-w-0 space-y-4 rounded-lg border border-border bg-card p-4">
          <div><h2 className="break-words text-lg font-semibold">{profile.config.name}</h2><p className="mt-1 break-all text-sm text-muted-foreground">{profile.config.model.provider}/{profile.config.model.model}</p></div>
          <p className="whitespace-pre-wrap break-words text-sm">{profile.config.instructions || "No additional instructions."}</p>
          <p className="text-sm text-muted-foreground">MSO read task · {profile.config.tools.length} selected tools</p>
          <p className="break-words text-xs text-muted-foreground">{profile.config.tools.join(", ") || "No tools: text responses only."}</p>
          <div className="flex flex-wrap gap-2">
            <Button className="min-h-11" size="sm" variant="outline" disabled={busy} onClick={() => setEditing({ profile })}>Edit profile</Button>
            <Button className="min-h-11" size="sm" variant="outline" disabled={busy} onClick={() => void act("clone", profile)}>Clone profile</Button>
            <Button className="min-h-11" size="sm" variant="outline" disabled={busy || !profile.enabled || catalog.store.defaultProfileId === profile.id} onClick={() => void act("default", profile)}>{catalog.store.defaultProfileId === profile.id ? "Default profile" : "Set default"}</Button>
            <Button className="min-h-11" size="sm" variant="outline" disabled={busy} onClick={() => void act(profile.enabled ? "disable" : "enable", profile)}>{profile.enabled ? "Disable profile" : "Enable profile"}</Button>
          </div>
          <details className="text-sm"><summary className="cursor-pointer rounded py-2 font-medium focus-visible:outline-2 focus-visible:outline-ring">Revision history ({profile.history.length})</summary><ol className="mt-2 space-y-3">{[...profile.history].reverse().map(entry => <li key={entry.revision} className="border-t border-border pt-3">
            <p className="font-medium">Revision {entry.revision} · {entry.action}</p><p className="mt-1 break-words">{entry.reason}</p><p className="mt-1 break-all text-xs text-muted-foreground">{entry.at} · {entry.actor}</p>
            <details><summary className="cursor-pointer py-2 text-xs focus-visible:outline-2 focus-visible:outline-ring">View saved configuration</summary><pre className="overflow-x-auto whitespace-pre-wrap break-words rounded bg-muted p-3 text-xs">{JSON.stringify(entry.config, null, 2)}</pre></details>
          </li>)}</ol></details>
          <ProfileTask key={`${profile.id}:${profile.revision}`} profile={profile} />
        </section>}
      </div>}
    </>}
  </div>;
}
