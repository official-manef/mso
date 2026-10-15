import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const roots: string[] = [];

async function load() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mso-tenant-config-"));
  fs.chmodSync(root, 0o700);
  roots.push(root);
  vi.resetModules();
  vi.stubEnv("OS_CONFIG_STORE", path.join(root, "owner-config.json"));
  vi.stubEnv("OS_MULTIUSER_ROOT", path.join(root, "users"));
  return import("./store");
}

afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("per-tenant credential store", () => {
  it("isolates tenant keys from the owner and from each other", async () => {
    const { hostCredentialStore } = await load();
    const store = hostCredentialStore();
    await store.setKey(undefined, "openai", "owner-key");
    await store.setKey("alice", "openai", "alice-key");
    await store.setKey("bob", "openai", "bob-key");
    expect(await store.getKey(undefined, "openai")).toBe("owner-key");
    expect(await store.getKey("alice", "openai")).toBe("alice-key");
    expect(await store.getKey("bob", "openai")).toBe("bob-key");
    await store.deleteKey("alice", "openai");
    expect(await store.getKey("alice", "openai")).toBeNull();
  });

  it("writes the tenant file under the multiuser root, not the owner file", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mso-tenant-layout-"));
    fs.chmodSync(root, 0o700);
    roots.push(root);
    vi.resetModules();
    vi.stubEnv("OS_CONFIG_STORE", path.join(root, "owner-config.json"));
    vi.stubEnv("OS_MULTIUSER_ROOT", path.join(root, "users"));
    const { hostCredentialStore } = await import("./store");
    await hostCredentialStore().setKey("alice", "openai", "alice-key");
    expect(fs.existsSync(path.join(root, "users", "alice", "config.json"))).toBe(true);
    expect(fs.existsSync(path.join(root, "owner-config.json"))).toBe(false);
    const written = JSON.parse(fs.readFileSync(path.join(root, "users", "alice", "config.json"), "utf8"));
    expect(written.keys.openai).toBe("alice-key");
  });

  it("never inherits owner env keys for a named tenant", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mso-tenant-env-"));
    fs.chmodSync(root, 0o700);
    roots.push(root);
    vi.resetModules();
    vi.stubEnv("OS_CONFIG_STORE", path.join(root, "owner-config.json"));
    vi.stubEnv("OS_MULTIUSER_ROOT", path.join(root, "users"));
    vi.stubEnv("OPENAI_API_KEY", "leaked-env-key");
    const { hostCredentialStore } = await import("./store");
    const store = hostCredentialStore();
    expect(await store.getKey(undefined, "openai")).toBe("leaked-env-key");
    expect(await store.getKey("alice", "openai")).toBeNull();
  });

  it("rejects traversal and prototype tenant ids", async () => {
    const { hostCredentialStore, safeTenantId } = await load();
    for (const bad of ["", "../openai", "a/b", "__proto__", "constructor", ".", ".."]) {
      expect(() => safeTenantId(bad)).toThrow("invalid tenant id");
    }
    await expect(hostCredentialStore().setKey("../escape", "openai", "x")).rejects.toThrow("invalid tenant id");
  });
});
