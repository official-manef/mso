"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ResponsiveDialog } from "@/features/appshell";
import { useSession } from "../lib/use-session";
import { ONBOARDING_KEY, ONBOARDING_OPEN, ONBOARDING_STEPS, onboardingStorage, readOnboardingProgress, shouldOpenOnboarding, writeOnboardingProgress, type OnboardingProgress } from "../lib/onboarding-state";
import { OnboardingReadiness } from "./onboarding-readiness";
import { OnboardingProjectPicker } from "./onboarding-project";
import { OnboardingReceipt } from "./onboarding-receipt";

const LABELS = { welcome: "Start", readiness: "Readiness", project: "Project", receipt: "First result" };

export function FirstLoginOnboarding() {
  const { role } = useSession();
  const [open, setOpen] = useState(() => typeof window !== "undefined" && shouldOpenOnboarding(onboardingStorage()));
  const [progress, setProgress] = useState<OnboardingProgress>(() => readOnboardingProgress(onboardingStorage()));
  const [storageError, setStorageError] = useState(false);

  useEffect(() => {
    const reopen = () => setOpen(true);
    window.addEventListener(ONBOARDING_OPEN, reopen);
    return () => window.removeEventListener(ONBOARDING_OPEN, reopen);
  }, []);

  function save(value: OnboardingProgress) {
    setProgress(value);
    setStorageError(!writeOnboardingProgress(onboardingStorage(), value));
  }

  function close() {
    try { onboardingStorage()?.setItem(ONBOARDING_KEY, "done"); } catch { setStorageError(true); }
    setOpen(false);
  }

  function navigate(href: string) {
    close();
    window.location.assign(href);
  }

  const steps = role === "owner" ? ONBOARDING_STEPS : ONBOARDING_STEPS.slice(0, 2);
  const step = steps.includes(progress.step) ? progress.step : "readiness";
  const index = steps.indexOf(step);
  const next = steps[index + 1];

  return <ResponsiveDialog open={open} onOpenChange={(value) => { if (!value) close(); }} size="lg" contentClassName="z-[70]">
    <ResponsiveDialog.Header>
      <ResponsiveDialog.Title>Set up MSO</ResponsiveDialog.Title>
      <ResponsiveDialog.Description>Check this host, choose a project and keep evidence of your first action.</ResponsiveDialog.Description>
    </ResponsiveDialog.Header>
    <ResponsiveDialog.Body className="space-y-5">
      <nav aria-label="Setup steps"><ol className="flex flex-wrap gap-1">{steps.map((value) => <li key={value}><Button variant={step === value ? "secondary" : "ghost"} className="min-h-11" aria-current={step === value ? "step" : undefined} onClick={() => save({ ...progress, step: value })}>{LABELS[value]}</Button></li>)}</ol></nav>
      {storageError ? <p role="alert" className="text-sm text-destructive">This browser could not save setup progress. Keep this tab open; any run receipt is still available in Workflows on the server.</p> : null}
      {step === "welcome" ? <section className="space-y-4" aria-labelledby="onboarding-start">
        <h3 id="onboarding-start" className="font-semibold">Use this installation as it is</h3>
        <p className="text-sm">Your approved device can continue with the existing host setup. A personal installation does not need a team or a new account to use this guide.</p>
        {role === "owner" ? <div className="space-y-3 rounded-lg border p-4">
          <h4 className="font-medium">Have an existing backup?</h4>
          <p className="text-sm text-muted-foreground">Review backup options before creating new work. Settings can import browser data and verify server memory snapshots in an isolated restore folder. These options do not replace a full installation restore.</p>
          <Button variant="outline" className="min-h-11" onClick={() => navigate("/settings?section=backup")}>Open backup options</Button>
        </div> : <p className="text-sm text-muted-foreground">An Owner manages backup and connection settings. Continue to review the access available to this device.</p>}
        <p className="text-xs text-muted-foreground">For installation or Owner recovery, use the supported local installer and <code>mso doctor</code>. Device approval remains available from the host; this guide does not replace it.</p>
      </section> : null}
      {step === "readiness" ? <OnboardingReadiness role={role} /> : null}
      {step === "project" && role === "owner" ? <OnboardingProjectPicker selected={progress.project} onFiles={() => navigate("/files")} onSelect={(project) => save({ step: "project", project, ...(project.id === progress.project?.id ? { attempt: progress.attempt } : {}) })} /> : null}
      {step === "receipt" && role === "owner" ? <OnboardingReceipt progress={progress} onProgress={save} onWorkflows={() => navigate("/workflows")} /> : null}
      <p className="text-xs text-muted-foreground">You can pause at any step. Reopen the guide from Settings → Account → About → Maintenance → Setup; your last step and receipt reference remain in this browser.</p>
    </ResponsiveDialog.Body>
    <ResponsiveDialog.Footer>
      <Button variant="ghost" className="min-h-11" onClick={close}>{next ? "Skip for now" : "Close guide"}</Button>
      {index > 0 ? <Button variant="outline" className="min-h-11" onClick={() => save({ ...progress, step: steps[index - 1] })}>Back</Button> : null}
      {next ? <Button className="min-h-11" disabled={step === "project" && !progress.project} onClick={() => save({ ...progress, step: next })}>{step === "welcome" ? "Check readiness" : step === "readiness" ? "Choose a project" : "Review first action"}</Button> : null}
    </ResponsiveDialog.Footer>
  </ResponsiveDialog>;
}
