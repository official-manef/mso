"use client";

import { cn } from "@/lib/utils";
import type { ProviderUsage } from "@/lib/ai/stream";
import { addProviderUsage } from "@/lib/ai/provider-usage.mjs";

export function formatTurnUsage(usage?: ProviderUsage | null, label = "this turn"): string {
  if (!usage) return "";
  const input = (usage.inputTokens ?? 0).toLocaleString();
  const output = (usage.outputTokens ?? 0).toLocaleString();
  const parts = [`${label}: ${input} in`, `${output} out`];
  if (usage.cacheReadTokens != null) {
    parts.push(`${usage.cacheReadTokens.toLocaleString()} cached`);
  }
  return parts.join(" / ");
}

export function formatThreadUsage(total?: ProviderUsage | null): string {
  return formatTurnUsage(total, "thread total");
}

export function formatUsageSummary(turn?: ProviderUsage | null, total?: ProviderUsage | null): string {
  const turnStr = formatTurnUsage(turn);
  const totalStr = formatThreadUsage(total);
  if (turnStr && totalStr) return `${turnStr} · ${totalStr}`;
  return turnStr || totalStr;
}

export function addUsage(total?: ProviderUsage | null, next?: ProviderUsage | null): ProviderUsage {
  return addProviderUsage(total, next) as ProviderUsage;
}

export function TurnUsage({
  turnUsage,
  threadTotal,
  className,
}: {
  turnUsage?: ProviderUsage | null;
  threadTotal?: ProviderUsage | null;
  className?: string;
}) {
  const turnStr = formatTurnUsage(turnUsage);
  const totalStr = formatThreadUsage(threadTotal);
  if (!turnStr && !totalStr) return null;

  return (
    <div
      data-testid="turn-usage"
      aria-label="Token usage"
      className={cn(
        "flex items-center gap-2 border-t border-border px-4 py-1 text-xs text-muted-foreground",
        className,
      )}
    >
      {turnStr ? <span>{turnStr}</span> : null}
      {turnStr && totalStr ? <span aria-hidden="true" className="opacity-50">·</span> : null}
      {totalStr ? <span>{totalStr}</span> : null}
    </div>
  );
}

export type { ProviderUsage };
