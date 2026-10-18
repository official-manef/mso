import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const preflight = readFileSync(new URL("./pr-preflight.sh", import.meta.url), "utf8");
const securityCI = readFileSync(new URL("../.github/workflows/security-core.yml", import.meta.url), "utf8");
const securityUltimate = readFileSync(new URL("./security-ultimate.sh", import.meta.url), "utf8");

describe("agent PR preflight", () => {
  it("exposes a documented, non-executing help route", () => {
    const result = spawnSync("bash", ["scripts/pr-preflight.sh", "--help"], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("CodeQL");
    expect(result.stdout).toContain("Draft PR");
  });
  it("rejects unknown switches instead of quietly ignoring them", () => {
    const result = spawnSync("bash", ["scripts/pr-preflight.sh", "--skip-security"], { encoding: "utf8" });
    expect(result.status).toBe(64);
  });
  it("reuses the committed release gate and refuses incomplete evidence", () => {
    expect(preflight).toContain("bash scripts/gates.sh");
    expect(preflight).toContain("bun run audit:strict");
    expect(preflight).toContain("git status --porcelain");
    expect(preflight).toContain("BLOCKED:");
    expect(preflight).toContain("CodeQL");
    expect(preflight).not.toContain("continue-on-error");
  });
  it("keeps shell and SAST scanner digests pinned to the required CI checks", () => {
    for (const name of ["semgrep/semgrep", "koalaman/shellcheck-alpine"]) {
      const image = preflight.match(new RegExp(name.replace("/", "\\/") + "@sha256:[a-f0-9]{64}"))?.[0];
      expect(image).toBeDefined();
      expect(securityCI).toContain(image);
      expect(securityUltimate).toContain(image);
    }
    expect(preflight).toContain("--strict --error /src");
    expect(preflight).toContain("--severity=warning -e SC1090,SC2034");
  });
});
