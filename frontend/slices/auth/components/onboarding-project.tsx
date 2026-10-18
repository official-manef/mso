"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { loadOnboardingProjects, onboardingError, type ProjectPage } from "../lib/onboarding-api";
import type { OnboardingProject } from "../lib/onboarding-state";

export function OnboardingProjectPicker({ selected, onSelect, onFiles }: { selected?: OnboardingProject; onSelect: (project: OnboardingProject) => void; onFiles: () => void }) {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState({ query: "", revision: 0 });
  const [page, setPage] = useState<ProjectPage | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void loadOnboardingProjects(search.query, controller.signal)
      .then((value) => { if (!controller.signal.aborted) setPage(value); })
      .catch((cause) => { if (!controller.signal.aborted) setError(onboardingError(cause)); });
    return () => controller.abort();
  }, [search]);

  function findProjects() {
    setPage(null);
    setError("");
    setSearch((value) => ({ query, revision: value.revision + 1 }));
  }

  return <section className="space-y-4" aria-labelledby="onboarding-project">
    <div className="space-y-2">
      <h3 id="onboarding-project" className="font-semibold">Choose the project to inspect</h3>
      <p className="text-sm text-muted-foreground">Select an existing project from this host. The check resolves it again and reads Git, package and knowledge metadata.</p>
    </div>
    <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); findProjects(); }}>
      <Input aria-label="Search host projects" value={query} maxLength={120} onChange={(event) => setQuery(event.target.value)} placeholder="Project name" className="min-h-11 min-w-0" />
      <Button type="submit" variant="outline" className="min-h-11">Search</Button>
    </form>
    {!page && !error ? <p role="status" className="text-sm">Finding projects in the configured roots…</p> : null}
    {error ? <div className="space-y-2"><p role="alert" className="text-sm text-destructive">Project discovery failed: {error}</p><Button variant="outline" className="min-h-11" onClick={findProjects}>Retry project discovery</Button></div> : null}
    {page?.rows.length === 0 ? <div className="space-y-2"><p className="text-sm">{search.query ? "No project matches this search. Try another name or clear the search." : "No projects were returned from the configured roots. Open Files to check the project location, then reopen this guide and search again."}</p><Button variant="outline" className="min-h-11" onClick={onFiles}>Open Files</Button></div> : null}
    {page?.rows.length ? <fieldset className="space-y-2"><legend className="sr-only">Available projects</legend>{page.rows.map((project) => <label key={project.id} className="flex min-h-11 cursor-pointer gap-3 rounded-lg border p-3 text-sm focus-within:ring-2 focus-within:ring-ring">
      <input type="radio" name="onboarding-project" value={project.id} checked={selected?.id === project.id} onChange={() => onSelect({ id: project.id, name: project.name })} className="mt-1 size-4 shrink-0 accent-[var(--primary)]" />
      <span className="min-w-0 [overflow-wrap:anywhere]"><span className="block font-medium">{project.name}</span><span className="text-xs text-muted-foreground">{project.path}</span></span>
    </label>)}</fieldset> : null}
    {page?.hasMore || page?.scan.truncated ? <p className="text-sm text-muted-foreground">This is a bounded discovery page; more projects may exist. Narrow the search by project name. If discovery is truncated, use the existing project tools to continue the scan.</p> : null}
    {selected ? <p role="status" className="text-sm [overflow-wrap:anywhere]">Selected: <strong>{selected.name}</strong> ({selected.id}). The run validates this exact project again.</p> : null}
  </section>;
}
