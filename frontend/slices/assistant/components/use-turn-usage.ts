"use client";

import { useCallback, useState } from "react";
import { addUsage, type ProviderUsage } from "./turn-usage";

// Per-turn and per-thread token accounting for the Alfa chat. Extracted from
// ChatPanel (which was tripping max-lines) so the panel stays about the run loop
// and this state has one home: `record` folds each turn's usage into the thread
// total, `reset` clears both when the conversation switches.
export function useTurnUsage() {
  const [turnUsage, setTurnUsage] = useState<ProviderUsage | null>(null);
  const [threadUsage, setThreadUsage] = useState<ProviderUsage | null>(null);
  const record = useCallback((usage?: ProviderUsage | null) => {
    if (!usage) return;
    setTurnUsage(usage);
    setThreadUsage((prev) => addUsage(prev, usage));
  }, []);
  const reset = useCallback(() => {
    setTurnUsage(null);
    setThreadUsage(null);
  }, []);
  return { turnUsage, threadUsage, record, reset };
}
