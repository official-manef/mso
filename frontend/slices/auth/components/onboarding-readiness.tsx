"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { roleLabel, type DeviceRole } from "@/lib/auth/roles";
import { loadReadiness, modelConfigured, onboardingError, onboardingJson, type ProviderCheck, type Readiness } from "../lib/onboarding-api";

export function OnboardingReadiness({ role }: { role: DeviceRole | null }) {
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [revision, setRevision] = useState(0);
  const [check, setCheck] = useState<ProviderCheck | null>(null);
  const [testing, setTesting] = useState(false);
  const request = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void loadReadiness(role, controller.signal).then((value) => { if (!controller.signal.aborted) setReadiness(value); });
    return () => controller.abort();
  }, [role, revision]);

  useEffect(() => () => request.current?.abort(), []);

  function refresh() {
    setReadiness(null);
    setCheck(null);
    setRevision((value) => value + 1);
  }

  async function testModel() {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setTesting(true);
    setCheck(null);
    try {
      const result = await onboardingJson<ProviderCheck>("/api/models/test", { method: "POST", signal: controller.signal });
      if (!controller.signal.aborted) setCheck(result);
    } catch (cause) {
      if (!controller.signal.aborted) setCheck({ ok: false, error: onboardingError(cause) });
    } finally {
      request.current = null;
      if (!controller.signal.aborted) setTesting(false);
    }
  }

  const host = readiness?.host;
  const model = readiness?.model;
  return <div className="space-y-5">
    <section className="space-y-3" aria-labelledby="onboarding-host">
      <h3 id="onboarding-host" className="font-semibold">Check this installation</h3>
      <p className="text-sm text-muted-foreground">Device role: {role ? roleLabel(role) : "Unavailable"}. Device roles apply to this host; they do not create separate user accounts or team workspaces.</p>
      {!readiness ? <p role="status" className="text-sm">Loading the host and saved model settings…</p> : null}
      {readiness?.hostError ? <p role="alert" className="text-sm text-destructive">Host check failed: {readiness.hostError}</p> : null}
      {host ? <dl className="space-y-2 rounded-lg border bg-muted/30 p-3 text-sm">
        <OnboardingValue label="Service user" value={host.linuxUser} />
        <OnboardingValue label="Read roots" value={host.readRoots.join(", ") || "No read roots configured"} />
        <OnboardingValue label="Write roots" value={host.writeRoots.join(", ") || "No write roots configured"} />
        <OnboardingValue label="Access route" value={host.currentAccess} />
      </dl> : null}
      {host?.publicExposureWarning ? <p className="text-sm text-muted-foreground">{host.publicExposureWarning}</p> : null}
      <Button variant="outline" className="min-h-11" onClick={refresh} disabled={!readiness || testing}>Refresh readiness</Button>
    </section>
    {role === "owner" ? <section className="space-y-3 border-t pt-4" aria-labelledby="onboarding-model">
      <h3 id="onboarding-model" className="font-semibold">Connect a model, when needed</h3>
      <p className="text-sm text-muted-foreground">The first project check works without AI. Model setup opens the existing private connection form in another tab; return here and refresh after saving.</p>
      {readiness?.modelError ? <p role="alert" className="text-sm text-destructive">Model settings unavailable: {readiness.modelError}</p> : null}
      {model ? <dl className="space-y-2 text-sm">
        <OnboardingValue label="Selected provider" value={model.provider} />
        <OnboardingValue label="Selected model" value={model.model} />
        <OnboardingValue label="Connection" value={modelConfigured(model) ? "Configured; test a request to verify access" : "Needs a credential or account connection"} />
      </dl> : null}
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="outline" className="min-h-11"><a href="/integrations?section=ai-providers" target="_blank" rel="noopener noreferrer">Open model connections</a></Button>
        <Button variant="outline" className="min-h-11" disabled={!modelConfigured(model) || testing} onClick={() => void testModel()}>{testing ? "Testing model request…" : "Test model request"}</Button>
      </div>
      <p className="text-xs text-muted-foreground">Testing sends a small request to the currently saved model and may use provider quota. It does not verify tool calls or every model capability.</p>
      {check ? <p role={check.ok ? "status" : "alert"} className={check.ok ? "text-sm" : "text-sm text-destructive"}>{check.ok ? `Provider accepted the test for ${check.provider || "the selected provider"}/${check.model || "the selected model"}.` : `Model check failed: ${check.error || "The provider did not confirm access. Reconnect and try again."}`}</p> : null}
    </section> : <p className="text-sm text-muted-foreground">An Owner connects models and runs this setup’s project check. Your current device can use the host features allowed by its role.</p>}
  </div>;
}

export function OnboardingValue({ label, value }: { label: string; value: string }) {
  return <div className="grid gap-1 sm:grid-cols-[9rem_minmax(0,1fr)]"><dt className="text-muted-foreground">{label}</dt><dd className="min-w-0 [overflow-wrap:anywhere]">{value}</dd></div>;
}
