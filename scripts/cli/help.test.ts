import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("help before private state", () => {
  for (const option of ["help", "-h", "--help"]) it(option, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mso-offline-help-"));
    try {
      const marker = path.join(dir, "env-executed"), envFile = path.join(dir, "secrets.env"), state = path.join(dir, "not-a-directory");
      fs.writeFileSync(envFile, `touch "${marker}"\nexit 93\n`, { mode: 0o600 });
      fs.writeFileSync(state, "unusable private store");
      const output = execFileSync("bash", ["bin/mso", "--env", envFile, option], {
        cwd: path.resolve(__dirname, "../.."), encoding: "utf8", env: { ...process.env, MSO_PRIVATE_STATE_DIR: state },
      });
      expect(output).toContain("Usage: mso");
      expect(fs.existsSync(marker)).toBe(false);
      expect(fs.readFileSync(state, "utf8")).toBe("unusable private store");
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
