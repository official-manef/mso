// Linux host probe for the PTY manager: spawn real Bash, execute a command,
// replay the output, and observe shell exit after close.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { attachPty, closePty, hasPty, openPty, writePty } from "./pty";


async function until(cond: () => boolean, ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  while (!cond() && Date.now() < deadline)
    await new Promise((r) => setTimeout(r, 25));
}

const OWNER = "owner-a";

describe("pty session manager", () => {
  it("opens a shell, runs echo, replays buffer, and dies on close", async () => {
    // The real PTY must not load the host owner's startup, readline or history
    // files. Keep the production login-shell arguments and exercise actual Bash.
    const fixture = mkdtempSync(path.join(tmpdir(), "mso-pty-e2e-"));
    let id: string | undefined;
    let detach = () => {};
    let detach2 = () => {};
    try {
      const shell = path.join(fixture, "shell");
      writeFileSync(path.join(fixture, "history"), "", { mode: 0o600 });
      writeFileSync(path.join(fixture, "inputrc"), "", { mode: 0o600 });
      writeFileSync(shell, `#!/bin/sh
MSO_PTY_FIXTURE_DIR=\${0%/*}
export HISTFILE="$MSO_PTY_FIXTURE_DIR/history"
export INPUTRC="$MSO_PTY_FIXTURE_DIR/inputrc"
exec /bin/bash --noprofile --norc "$@"
`, { mode: 0o700 });
      vi.stubEnv("SHELL", shell);
      const opened = await openPty({ cols: 80, rows: 24, owner: OWNER });
      id = opened.id;
      const { cwd } = opened;
      expect(cwd.length).toBeGreaterThan(0);
      expect(hasPty(id, OWNER)).toBe(true);

      let out = "";
      let exit: number | null = null;
      detach = attachPty(id, OWNER, 0, {
        onData: (chunk) => (out += chunk),
        onExit: (code) => (exit = code),
      });

      // $((20+22)) proves the SHELL ran it (the keystroke echo alone still
      // contains the literal "$((20+22))", never the expanded 42).
      writePty(id, OWNER, "echo pty-e2e-$((20+22))\n");
      await until(() => out.includes("pty-e2e-42"), 8000);
      expect(out).toContain("pty-e2e-42");

      // A second attach from offset 0 must replay the same buffered output.
      let replay = "";
      detach2 = attachPty(id, OWNER, 0, { onData: (c) => (replay += c), onExit: () => {} });
      expect(replay).toContain("pty-e2e-42");
      detach2();

      expect(closePty(id, OWNER)).toBe(true);
      await until(() => exit !== null, 8000);
      expect(exit).not.toBeNull();
      expect(closePty(id, OWNER)).toBe(false); // idempotent after death
      detach();
    } finally {
      detach2();
      detach();
      try { if (id) closePty(id, OWNER); }
      finally {
        vi.unstubAllEnvs();
        rmSync(fixture, { recursive: true, force: true });
      }
    }
  }, 20_000);
});
