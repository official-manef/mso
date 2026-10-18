export function profileErrorText(code: string): string {
  if (code.includes("revision_conflict")) return "This profile changed in another tab. Refresh, then reopen the latest revision before saving or running.";
  if (code === "profile_disabled") return "This profile is disabled. Enable it before running.";
  if (code.includes("owner") || code === "unauthorized") return "An active Owner session is required. Sign in again if this device was revoked or changed.";
  if (code.startsWith("no_api_key:")) return `Connect ${code.slice(11)} in Settings before running this profile.`;
  if (code === "profile_run_already_active") return "A saved-profile task is already running on this device. Wait for it to finish or stop it.";
  if (code === "rate_limited") return "Too many tasks were started. Wait one minute before trying again.";
  if (code.includes("unsupported")) return "This configuration is not supported by the current profile runtime.";
  if (code === "profile_commit_uncertain_refresh_before_retry") return "The save outcome could not be confirmed. Refresh and check the revision before trying again.";
  if (code === "profile_run_timeout") return "The task reached its one-minute limit. Its session records the steps that completed.";
  if (code === "oauth_refresh_failed") return "The selected model connection needs attention. Reconnect it in Settings.";
  return "The profile request failed. Refresh to check its saved state, then try again.";
}

export async function profileResponse<T>(response: Response): Promise<T> {
  const body = await response.json();
  if (!response.ok) throw new Error(profileErrorText(String(body.error ?? "profile_request_failed")));
  return body as T;
}
