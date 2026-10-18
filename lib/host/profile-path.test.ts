import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { assertNoCredentialDescendants, isCredentialPath, resolveReadable, safeWritePath, sensitiveExcludes } from "./paths";

let root: string, profiles: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "mso-profile-path-")); profiles = path.join(root, "profiles");
  await mkdir(profiles); await writeFile(path.join(profiles, "owner.json"), "synthetic-policy");
  vi.stubEnv("OS_AGENT_PROFILES_DIR", profiles); vi.stubEnv("OS_FS_READ_ROOTS", root); vi.stubEnv("OS_FS_WRITE_ROOTS", root);
});
afterEach(async () => { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });

describe("saved profile filesystem boundary", () => {
  it.each(["0", "1"])("blocks direct and recursive access with OS_FS_ALLOW_SENSITIVE=%s", async sensitive => {
    vi.stubEnv("OS_FS_ALLOW_SENSITIVE", sensitive);
    const file = path.join(profiles, "owner.json");
    await expect(resolveReadable(file)).rejects.toThrow(/credential/);
    await expect(safeWritePath(file, true)).rejects.toThrow(/credential/);
    await expect(assertNoCredentialDescendants(root)).rejects.toThrow(/credential/);
    expect(sensitiveExcludes(root)).toContain("profiles/*");
    expect(isCredentialPath(path.join(root, "profiles-other", "owner.json"))).toBe(false);
  });
  it("blocks canonical aliases of an explicitly configured profile directory", async () => {
    const alias = path.join(root, "alias"); await symlink(profiles, alias);
    vi.stubEnv("OS_AGENT_PROFILES_DIR", alias); vi.stubEnv("OS_FS_ALLOW_SENSITIVE", "1");
    expect(isCredentialPath(path.join(profiles, "owner.json"))).toBe(true);
    await expect(resolveReadable(path.join(alias, "owner.json"))).rejects.toThrow(/credential/);
  });
});
