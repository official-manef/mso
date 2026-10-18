"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { AIStore } from "../lib/store";
import type { Agent } from "../lib/types";
import { LibraryGrid } from "./library-grid";
import { ProfilesPanel } from "./profiles-panel";

export function AgentLibrary({ store, onNew, onEdit }: { store: AIStore; onNew: () => void; onEdit: (agent: Agent) => void }) {
  const [saved, setSaved] = useState(true);
  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="flex flex-wrap gap-2 border-b border-border px-4 py-2" aria-label="Agent libraries">
      <Button className="min-h-11" variant={saved ? "secondary" : "ghost"} aria-pressed={saved} onClick={() => setSaved(true)}>Saved profiles</Button>
      <Button className="min-h-11" variant={!saved ? "secondary" : "ghost"} aria-pressed={!saved} onClick={() => setSaved(false)}>Browser personas</Button>
    </div>
    {saved ? <div className="min-h-0 flex-1 overflow-auto"><ProfilesPanel /></div> : <LibraryGrid kind="agent" store={store} onNew={onNew} onEdit={item => onEdit(item as Agent)} />}
  </div>;
}
