"use client";

import { Button } from "@/components/ui/button";
import { SettingsBlock } from "@/features/shell-settings";
import type { RuntimeIdentity } from "@/lib/contracts/runtime-identity";
import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { isRemoteMcpOrigin, mcpEndpoints, type McpProbeResult } from "./mcp-client-core";
import { McpConnectionMode } from "./mcp-connection-mode";
import { McpCopyField } from "./mcp-copy-field";
import { probeMcpConnection } from "./mcp-probe";
import { McpProbeStatus } from "./mcp-probe-status";

function sameOriginFetch(input: RequestInfo | URL, init?: RequestInit) {
  const target = new URL(String(input));
  return fetch(target.pathname + target.search, init);
}
type ProbeSnapshot = { origin: string; attempt: number; expectedInstance: string | null; result: McpProbeResult | null };

export function McpConnectionSection({ origin, targetIdentity }: { origin: string; targetIdentity?: RuntimeIdentity | null }) {
  const [snapshot, setSnapshot] = useState<ProbeSnapshot | null>(null);
  const [attempt, setAttempt] = useState(0);
  const expectedInstance = targetIdentity?.runtimeInstanceId ?? null;
  const current = snapshot?.origin === origin && snapshot.attempt === attempt && snapshot.expectedInstance === expectedInstance ? snapshot : null;
  const result = current?.result ?? null;
  const checking = current === null;
  const endpoints = mcpEndpoints(origin);
  useEffect(() => {
    const controller = new AbortController();
    probeMcpConnection(origin, sameOriginFetch, {
      observedOrigin: window.location.origin, signal: controller.signal, expectedRuntimeInstanceId: expectedInstance,
    }).then(next => {
      if (!controller.signal.aborted) setSnapshot({ origin, attempt, expectedInstance, result: next });
    }).catch(() => {
      if (!controller.signal.aborted) setSnapshot({ origin, attempt, expectedInstance, result: null });
    });
    return () => controller.abort();
  }, [origin, attempt, expectedInstance]);

  return <div className="space-y-4">
    {targetIdentity && <SettingsBlock className="space-y-3 py-4">
      <h3 className="text-sm font-medium">Current server</h3>
      <p className="text-sm text-muted-foreground">Identity loaded with Settings. The runtime ID is checked again when available; it can change after a restart.</p>
      <dl aria-label="Current server identity" className="grid gap-3 text-sm @min-[520px]:grid-cols-2">
        {[
          ["Hostname", targetIdentity.hostname],
          ["Service user", targetIdentity.serviceUser ?? "Unavailable"],
          ["Runtime instance", targetIdentity.runtimeInstanceId ?? "Unavailable"],
          ["Environment", targetIdentity.environment ?? "Not configured"],
        ].map(([label, value]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="break-all">{value}</dd></div>)}
      </dl>
    </SettingsBlock>}
    <SettingsBlock className="space-y-3 py-4">
      <McpProbeStatus state={checking ? "checking" : result?.ready ? "ready" : "error"} result={result} endpoint={endpoints.mcp} />
      <Button variant="secondary" disabled={checking} onClick={() => setAttempt(value => value + 1)} className="min-h-11"><RefreshCw aria-hidden className="size-4" />{checking ? "Checking…" : "Check connection"}</Button>
    </SettingsBlock>
    <SettingsBlock className="py-4"><McpConnectionMode endpoints={endpoints} remote={isRemoteMcpOrigin(origin)} /></SettingsBlock>
    <SettingsBlock className="py-4">
      <details><summary className="min-h-11 cursor-pointer py-3 text-sm font-medium">Manual OAuth configuration</summary>
        <p className="mb-3 text-sm text-muted-foreground">Only needed if your app asks for individual OAuth endpoints.</p>
        <div className="grid gap-3 @min-[520px]:grid-cols-2">
          <McpCopyField label="MCP server URL" value={endpoints.mcp} />
          <McpCopyField label="Authorization URL" value={endpoints.authorize} />
          <McpCopyField label="Token URL" value={endpoints.token} />
          <McpCopyField label="Dynamic registration" value={endpoints.register} />
          <McpCopyField label="Protected-resource metadata" value={endpoints.protectedResource} />
          <McpCopyField label="Authorization-server metadata" value={endpoints.authorizationServer} />
        </div>
        <p className="mt-3 text-sm text-muted-foreground">Register your app and its callback URL at the dynamic registration endpoint to obtain a unique Client ID. OAuth uses PKCE S256 without a client secret. Access tokens last one hour; refresh grants expire 90 days after authorization. Reconnect if renewal fails or access is revoked.</p>
      </details>
    </SettingsBlock>
  </div>;
}
