"use client";

import { CheckCircle2, CircleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { MCP_PROBE_LABELS, type McpProbeResult } from "./mcp-client-core";

export type ProbeState = "checking" | "ready" | "error";
const stateLabels = { passed: "Passed", failed: "Failed", unknown: "Unknown" };

export function McpProbeStatus({ state, result, endpoint }: { state: ProbeState; result: McpProbeResult | null; endpoint: string }) {
  const ready = state === "ready";
  return (
    <div role="status" aria-live="polite" aria-busy={state === "checking"} className="space-y-3 rounded-lg border border-border px-3 py-3">
      <div className="flex items-start gap-2">
        {ready ? <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0 text-success" /> : <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />}
        <div className="min-w-0">
          <p className="text-sm font-medium">{ready ? "Server discovery checks passed" : state === "error" ? "Some server checks need attention" : "Checking this server…"}</p>
          {state === "error" && !result && <p className="mt-1 text-sm text-muted-foreground">The check could not finish. Verify the server address and try again.</p>}
        </div>
      </div>
      <dl className="space-y-2 text-sm">
        <div><dt className="text-muted-foreground">Observed origin</dt><dd className="break-all">{result?.observedOrigin ?? "Checking…"}</dd></div>
        <div><dt className="text-muted-foreground">Configured MCP endpoint</dt><dd className="break-all">{endpoint}</dd></div>
        {result && <div><dt className="text-muted-foreground">Checked</dt><dd><time dateTime={result.checkedAt}>{new Date(result.checkedAt).toLocaleString()}</time></dd></div>}
      </dl>
      {result && <ul aria-label="Connection checks" className="divide-y divide-border">
        {result.checks.map(check => (
          <li key={check.id} data-probe-check={check.id} className="space-y-1 py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <p className="text-sm font-medium">{MCP_PROBE_LABELS[check.id]}</p>
              <span className={cn("text-sm font-medium", check.state === "failed" ? "text-destructive" : "text-foreground")}>{stateLabels[check.state]}</span>
            </div>
            <p className="text-sm text-muted-foreground">{check.detail}</p>
            {check.guidance && <p className="text-sm text-foreground">{check.guidance}</p>}
          </li>
        ))}
      </ul>}
    </div>
  );
}
