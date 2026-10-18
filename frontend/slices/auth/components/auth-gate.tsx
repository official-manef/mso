"use client";

import { cn } from "@/lib/utils";
import { type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { useAppearance } from "@/lib/appearance";
import { IS_DEMO } from "@/lib/demo";
import { useSession } from "../lib/use-session";
import { ONBOARDING_OPEN } from "../lib/onboarding-state";
import { FirstLoginOnboarding } from "./first-login-onboarding";

// The shell is PUBLIC: anyone can open it and browse on mock data — no sign-in
// wall. Sign-in unlocks device-role-gated live host access (files/terminal/
// monitor); every /api host route enforces the session server-side, so a
// signed-out visitor is confined to mock (see lib/os-api). Sign-in is available directly at /login and
// inside Settings → Server. This gate resolves the session before showing the
// shell while the shell-native system status keeps its actual mock/live mode visible.
export function AuthGate({ children }: { children: ReactNode }) {
  if (IS_DEMO) {
    return (
      <>
        {children}
        <DemoModeOverlay />
      </>
    );
  }
  return <GatedOS>{children}</GatedOS>;
}

function DemoModeOverlay() {
  const tasks = [
    "Open System Monitor",
    "Browse a sample project",
    "Open Terminal",
    "Switch to mobile view",
    "Ask Alfa about a mock server warning",
  ];
  return (
    <>
      <div className="pointer-events-none fixed inset-x-0 top-0 z-[60] bg-amber-500 px-3 py-1.5 text-center text-xs font-bold text-amber-950 shadow">
        Demo Mode — Mock data only. No real server is connected.
      </div>
      <div className="pointer-events-none fixed bottom-3 left-3 z-[60] max-w-[min(22rem,calc(100vw-1.5rem))] rounded-lg border border-border/70 bg-popover/95 p-3 text-xs text-popover-foreground shadow-lg backdrop-blur">
        <div className="mb-1 font-semibold">Guided demo</div>
        <ol className="space-y-0.5">
          {tasks.map((task, i) => (
            <li key={task}>{i + 1}. {task}</li>
          ))}
        </ol>
      </div>
    </>
  );
}

function GatedOS({ children }: { children: ReactNode }) {
  const { status } = useSession();
  if (status === "loading") return <Splash />;
  return (
    <>
      {children}
      {status === "in" && <FirstLoginOnboarding />}
    </>
  ); // signed-in AND signed-out → the shell (mock when out)
}

function Splash() {
  const { tweaks } = useAppearance();
  // Always paint a wallpaper-ish surface under the spinner so session loading
  // never shows the blank grey body (UX-02). Prefer the user's wallpaper token;
  // fall back to aurora gradient via wp-aurora.
  const wp = tweaks.wallpaper === "auto" ? "aurora" : tweaks.wallpaper;
  return (
    <div className="relative grid h-dvh w-screen place-items-center bg-[var(--surface)]">
      <div
        className={cn(!tweaks.wallpaperStyle && `wp-${wp}`, "absolute inset-0 -z-10 bg-cover bg-center")}
        style={tweaks.wallpaperStyle}
        aria-hidden
      />
      <Loader2 className="size-6 animate-spin text-white drop-shadow" aria-label="Loading" />
    </div>
  );
}

export function openOnboarding() {
  window.dispatchEvent(new Event(ONBOARDING_OPEN));
}
