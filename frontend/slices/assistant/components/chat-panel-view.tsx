"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { AlfaApprovalGrants, AlfaRunProgress, ChatComposer, sendToAlfa, useActiveShell, type ChatMessage } from "@/features/appshell";
import { ChatTranscript } from "./chat-transcript";
import { EmptyState } from "./empty-state";
import { TurnUsage, type ProviderUsage } from "./turn-usage";

const SUGGESTED = ["Show system stats", "List ~/projects", "Create notes.txt in ~/projects with a TODO"];

export function ChatPanelView({ mode, messages, prompts, switcher, cockpit, streaming, turnUsage, threadUsage, onResolve, onStop }: {
  mode: string;
  messages: ChatMessage[];
  prompts: string[];
  switcher: ReactNode;
  cockpit?: ReactNode;
  streaming: boolean;
  turnUsage: ProviderUsage | null;
  threadUsage: ProviderUsage | null;
  onResolve: (id: string, approve: boolean, remember: boolean) => void;
  onStop: () => void;
}) {
  const ios = useActiveShell().id === "ios";
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Coalesce token updates into one frame without restarting a smooth scroll.
    const id = requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: "auto", block: "end" }));
    return () => cancelAnimationFrame(id);
  }, [messages]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 overflow-x-auto border-b border-border bg-card/40 px-3 py-2 [scrollbar-width:none]">
        {switcher}
      </div>
      {cockpit}
      <AlfaRunProgress />
      <AlfaApprovalGrants />
      <div className={cn("px-3 py-1 text-center text-[11px] font-medium", mode === "live" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground")}>
        {mode === "live"
          ? "● LIVE — Alfa acts on your real VPS; every change needs your approval"
          : "MOCK — actions are simulated (switch to Live in Settings → Server)"}
      </div>
      {messages.length === 0 ? (
        <div className="flex-1 overflow-y-auto">
          <EmptyState prompts={[...new Set([...prompts, ...SUGGESTED])].slice(0, 6)} onPick={(t) => void sendToAlfa(t)} />
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <div data-native-context-menu onContextMenu={(e) => e.stopPropagation()} className={cn("flex flex-col p-4", ios ? "gap-1.5" : "gap-4")}>
            <ChatTranscript messages={messages} ios={ios} onResolve={onResolve} />
            <div ref={bottomRef} />
          </div>
        </ScrollArea>
      )}
      <TurnUsage turnUsage={messages.length > 0 ? turnUsage : null} threadTotal={messages.length > 0 ? threadUsage : null} />
      {/* All surfaces share the sendToAlfa single-flight guard and busy state. */}
      <ChatComposer onSend={(t) => void sendToAlfa(t)} streaming={streaming} onStop={onStop} />
    </div>
  );
}
