import { spawn } from "node:child_process";
import path from "node:path";
import { AgentGroupError } from "./errors";

const TIMEOUT_MS = 90_000;
const MAX_OUTPUT = 64 * 1024;
const PROFILE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const SESSION = /^[A-Za-z0-9_-]{1,80}$/;

export type HermesTurnInput = {
  profile: string;
  prompt: string;
  system?: string;
  resumeSessionId?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
};

export type HermesTurnResult = {
  text: string;
  sessionId?: string;
};

// Hermes writes a status banner and session id to stderr; stdout holds the
// model reply plus occasional informational lines. Keep only reply lines.
function cleanReply(raw: string): string {
  return raw
    .split("\n")
    .filter((line) => !/^\s*(?:⚠|warning:|session_id:|\[hermes\]|info:|debug:)/i.test(line))
    .join("\n")
    .trim();
}

export function buildHermesQuery(prompt: string, system?: string): string {
  return system ? `${system}\n\n---\n\n${prompt}` : prompt;
}

// Runs one headless Hermes turn for a single profile. Never uses a shell, so
// arbitrary prompt text is passed verbatim (no quoting or injection risk).
export async function runHermesTurn(input: HermesTurnInput): Promise<HermesTurnResult> {
  const profile = input.profile.trim();
  if (!PROFILE.test(profile)) throw new AgentGroupError("invalid_group_profile");
  if (!input.prompt.trim()) throw new AgentGroupError("invalid_group_prompt");
  if (input.prompt.length > 4000) throw new AgentGroupError("invalid_group_prompt");
  let resumeSessionId: string | undefined;
  if (input.resumeSessionId !== undefined) {
    if (!SESSION.test(input.resumeSessionId)) throw new AgentGroupError("invalid_group_session");
    resumeSessionId = input.resumeSessionId;
  }

  const binary = process.env.HERMES_BIN ?? path.join(process.env.HOME ?? "/home", ".local", "bin", "hermes");
  const args = ["chat", "-p", profile, "-Q", "-q", buildHermesQuery(input.prompt, input.system)];
  if (resumeSessionId) args.push("-r", resumeSessionId);

  const captured = await new Promise<{ out: string; err: string }>((resolve, reject) => {
    const child = spawn(binary, args, {
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    let err = "";
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      input.signal?.removeEventListener("abort", onAbort);
      fn();
    };
    const onAbort = () => {
      child.kill("SIGKILL");
      finish(() => reject(new AgentGroupError("agent_group_stopped", 409)));
    };
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(() => reject(new AgentGroupError("agent_group_timeout", 504)));
    }, input.timeoutMs ?? TIMEOUT_MS);
    input.signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      out += chunk;
      if (out.length > MAX_OUTPUT) {
        child.kill("SIGKILL");
        finish(() => reject(new AgentGroupError("agent_group_output_too_large", 413)));
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      err += chunk;
      if (err.length > MAX_OUTPUT) err = err.slice(-MAX_OUTPUT);
    });
    child.on("error", () => finish(() => reject(new AgentGroupError("agent_group_spawn_failed", 500))));
    child.on("close", (code) => {
      finish(() => {
        if (code === 0) resolve({ out, err });
        else reject(new AgentGroupError(`agent_group_exit_${code ?? "signal"}`, 502));
      });
    });
  });

  const sessionId = `${captured.out}\n${captured.err}`.match(/session_id:\s*([A-Za-z0-9_-]+)/)?.[1] ?? undefined;
  return { text: cleanReply(captured.out), ...(sessionId ? { sessionId } : {}) };
}
