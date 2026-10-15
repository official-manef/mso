"use client";

import { memo, useState } from "react";
import {
  Check,
  FilePlus,
  FileText,
  FolderPlus,
  FolderSearch,
  ListTree,
  Loader2,
  MemoryStick,
  Play,
  ShieldAlert,
  Terminal,
  Trash2,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { ChatMessage, ToolStatus } from "./message-bubble";
import { canRememberAlfaTool } from "../lib/alfa-approval-policy";

// Human-readable tool identity, OpenDots-style: the transcript says "Saving file",
// not "fs.write". Icons + labels live in one table so the card reads like a status
// line instead of a raw function dump. Unknown/new tools fall back to the raw name.
const TOOLS: Record<string, { label: string; icon: LucideIcon }> = {
  "fs.read": { label: "Reading file", icon: FileText },
  "fs.write": { label: "Saving file", icon: FilePlus },
  "fs.list": { label: "Listing files", icon: ListTree },
  "fs.search": { label: "Searching files", icon: FolderSearch },
  "fs.usage": { label: "Checking disk usage", icon: ListTree },
  "fs.mkdir": { label: "Creating folder", icon: FolderPlus },
  "fs.move": { label: "Moving file", icon: FileText },
  "fs.copy": { label: "Copying file", icon: FileText },
  "fs.delete": { label: "Deleting file", icon: Trash2 },
  "exec.run": { label: "Running command", icon: Terminal },
  "memory.remember": { label: "Remembering", icon: MemoryStick },
  "memory.forget": { label: "Forgetting", icon: MemoryStick },
  "skills.list": { label: "Listing skills", icon: ListTree },
  "skills.read": { label: "Reading skill", icon: FileText },
  "skills.search": { label: "Searching skills", icon: FolderSearch },
  "app.open": { label: "Opening app", icon: Play },
  "apps.list": { label: "Listing apps", icon: ListTree },
  "apps.logs": { label: "Reading app logs", icon: FileText },
  "apps.power": { label: "Toggling app", icon: Play },
  "browser.status": { label: "Checking browser", icon: Wrench },
  "browser.power": { label: "Toggling browser", icon: Play },
  "sys.stats": { label: "Reading system stats", icon: Wrench },
  "sys.processes": { label: "Listing processes", icon: Wrench },
};

// State word shown on the right, OpenDots-style. Never invent "success": a read that
// has not started is Pending, and a denied call is Denied, not Failed.
const STATE: Record<ToolStatus, string> = {
  pending: "Needs your approval",
  running: "Working",
  ok: "Finished",
  error: "Needs attention",
  denied: "Denied",
};

export function toolIdentity(name: string): { label: string; icon: LucideIcon } {
  return TOOLS[name] ?? { label: name, icon: Wrench };
}


// Renders a role:"tool" message — one host tool call. A pending MUTATE call shows
// the full args + Approve/Deny (the agent loop is parked awaiting the click);
// reads and finished calls render as compact status chips. Colours use theme
// tokens only (primary = mutate/ok, destructive = denied/refused).
//
// memoised: the transcript re-renders on every streamed token, but a parked card
// is unchanged — without this each token re-ran the full-args render.
export const ApprovalCard = memo(function ApprovalCard({
  message,
  onResolve,
}: {
  message: ChatMessage;
  onResolve: (id: string, approve: boolean, remember: boolean) => void;
}) {
  const [remember, setRemember] = useState(false);
  const t = message.tool;
  if (!t) return null;
  const { label, icon: Icon } = toolIdentity(t.name);
  const pending = t.status === "pending";
  const bad = t.status === "error" || t.status === "denied";
  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2 text-xs",
        pending ? "border-primary/50 bg-primary/5" : bad ? "border-destructive/40 bg-destructive/5" : "border-border bg-muted/40",
      )}
    >
      <div className="flex items-center gap-1.5">
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="font-medium">{label}</span>
        {/* Raw tool name kept as a dimmed mono breadcrumb: the human label is for
            scanning, but the exact capability stays visible for audit. */}
        <code className="truncate text-[10px] text-muted-foreground/70">{t.name}</code>
        <span
          className={cn(
            "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
            t.effect === "mutate" ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
          )}
        >
          {t.effect}
        </span>
        {t.status === "running" && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
        {t.status === "ok" && <Check className="size-3.5 text-primary" />}
        {(t.status === "error" || t.status === "denied") && <X className="size-3.5 text-destructive" />}
        <span className={cn("ml-auto shrink-0 text-[10px]", bad ? "text-destructive" : "text-muted-foreground")}>
          {STATE[t.status]}
        </span>
      </div>

      <ToolArgs name={t.name} input={t.input} />

      {t.danger && (
        <div className="mt-1.5 flex items-center gap-1.5 rounded bg-destructive/15 px-2 py-1 text-[11px] text-destructive">
          <ShieldAlert className="size-3.5 shrink-0" /> Server will refuse this: {t.danger}
        </div>
      )}

      {t.result && !pending && (
        <p className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-muted-foreground">
          {t.result.length > 600 ? `${t.result.slice(0, 600)}…` : t.result}
        </p>
      )}

      {pending && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" className="h-7 px-2.5 text-xs [@media(pointer:coarse)]:min-h-[44px]" onClick={() => onResolve(message.id, true, remember)}>
            Approve
          </Button>
          <Button type="button" size="sm" variant="outline" className="h-7 px-2.5 text-xs [@media(pointer:coarse)]:min-h-[44px]" onClick={() => onResolve(message.id, false, false)}>
            Deny
          </Button>
          {!t.danger && t.approvalScope && canRememberAlfaTool(t.name, t.input) && (
            <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground [@media(pointer:coarse)]:min-h-11">
              <Switch checked={remember} onCheckedChange={setRemember} /> Always approve this exact call
            </label>
          )}
          {t.approvalScope ? <p className="w-full break-words text-[11px] text-muted-foreground">Scope: {t.name} + identical arguments · {t.approvalScope}</p> : null}
        </div>
      )}
    </div>
  );
});

// The exact input object passed to the tool is the approval artifact. Mutation-critical
// values are never truncated; large values stay fully present inside a bounded scroll area.
export function canonicalToolInput(input: Record<string, unknown>): string {
  return JSON.stringify(input, null, 2);
}

function FullValue({ children }: { children: string }) {
  return (
    <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-background/60 px-2 py-1 font-mono text-[10px]">
      {children}
    </pre>
  );
}

function ToolArgs({ name, input }: { name: string; input: Record<string, unknown> }) {
  if (name === "exec.run") {
    return (
      <div className="mt-1.5 space-y-1">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Exact command</p>
        <FullValue>{String(input.cmd ?? "")}</FullValue>
        {input.cwd !== undefined ? (
          <><p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Working directory</p><FullValue>{String(input.cwd)}</FullValue></>
        ) : null}
      </div>
    );
  }
  if (name === "fs.write") {
    const content = String(input.content ?? "");
    const bytes = new TextEncoder().encode(content).byteLength;
    return (
      <div className="mt-1.5 text-[11px]">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Exact destination</p>
        <FullValue>{String(input.path ?? "")}</FullValue>
        <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Full content ({bytes} bytes)</p>
        <FullValue>{content}</FullValue>
      </div>
    );
  }
  if (name === "fs.move" || name === "fs.copy") {
    return (
      <div className="mt-1.5 text-[11px]">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Exact source</p>
        <FullValue>{String(input.from ?? "")}</FullValue>
        <p className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Exact destination</p>
        <FullValue>{String(input.to ?? "")}</FullValue>
      </div>
    );
  }
  if (name === "fs.delete" || name === "fs.mkdir") {
    return (
      <div className="mt-1.5 text-[11px]">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Exact path</p>
        <FullValue>{String(input.path ?? "")}</FullValue>
      </div>
    );
  }
  const canonical = canonicalToolInput(input);
  if (canonical === "{}") return null;
  return (
    <div className="mt-1.5">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Complete arguments</p>
      <FullValue>{canonical}</FullValue>
    </div>
  );
}
