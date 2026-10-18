import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const mock = vi.hoisted(() => ({ auth: vi.fn(), live: vi.fn() }));
vi.mock("@/lib/auth/require-session", () => ({ getSessionContext: mock.auth }));
vi.mock("@/lib/auth/live-authorization", () => ({ liveSessionAuthorized: mock.live }));
vi.mock("@/lib/config/store", () => ({ DEFAULT_PROVIDER: "anthropic", readConfig: async () => ({ provider: "private-connection", model: "exact-model", keys: { private: "credential-never-in-catalog" } }) }));
vi.mock("@/lib/mcp/capability-runtime", () => ({ msoCapabilityRuntime: { list: () => [
  { name: "fs_read", scope: "read", description: "Read a file" },
  { name: "exec_run", scope: "exec", description: "Execute" },
] } }));
const { GET, POST } = await import("./route");
const ownerSession = { session: { device_id: "aaaaaaaaaaaaaaaa" }, role: "owner" };
const config = { name: "Reader", avatar: "", instructions: "", runtime: "mso-readonly", model: { provider: "private-connection", model: "exact-model" }, tools: ["fs_read"] };
const request = (body: unknown) => new Request("https://mso.invalid/api/v1/agent-profiles", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
let root: string;
beforeEach(async () => { root = await mkdtemp(path.join(os.tmpdir(), "mso-profile-api-")); vi.stubEnv("OS_AGENT_PROFILES_DIR", root); mock.auth.mockResolvedValue(ownerSession); mock.live.mockResolvedValue(true); });
afterEach(async () => { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });

describe("profile HTTP lifecycle", () => {
  it.each([null, { ...ownerSession, role: "operator" }, { ...ownerSession, role: "viewer" }])("requires Owner for reads and writes: %j", async auth => {
    mock.auth.mockResolvedValue(auth);
    expect((await GET()).status).toBe(auth ? 403 : 401);
    expect((await POST(request({}))).status).toBe(auth ? 403 : 401);
  });
  it("returns a secret-free catalog and persists to the authenticated owner", async () => {
    const response = await GET();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const catalog = await response.json();
    expect(catalog.selectedModel).toEqual(config.model);
    expect(catalog.tools).toEqual([{ name: "fs_read", description: "Read a file" }]);
    expect(JSON.stringify(catalog)).not.toContain("credential-never-in-catalog");
    const created = await POST(request({ action: "create", expectedRevision: 0, config, reason: "Owner created profile" }));
    expect(created.status).toBe(200);
    expect((await created.json()).store.profiles[0].owner).toBe("web:aaaaaaaaaaaaaaaa");
    mock.auth.mockResolvedValue({ session: { device_id: "bbbbbbbbbbbbbbbb" }, role: "owner" });
    expect((await (await GET()).json()).store.profiles).toEqual([]);
  });
  it("rejects spoofed principals, unsupported writes and oversized bodies", async () => {
    expect((await POST(request({ action: "create", expectedRevision: 0, config, owner: "other", reason: "spoof" }))).status).toBe(400);
    expect((await POST(request({ action: "create", expectedRevision: 0, config: { ...config, tools: ["exec_run"] }, reason: "unsupported" }))).status).toBe(422);
    expect((await POST(request({ padding: "x".repeat(17000) }))).status).toBe(413);
    expect((await (await GET()).json()).store.profiles).toEqual([]);
  });
  it("rechecks the session after body read and returns a conflict on a stale revision", async () => {
    mock.live.mockResolvedValue(false);
    expect((await POST(request({ action: "create", expectedRevision: 0, config, reason: "revoked" }))).status).toBe(403);
    mock.live.mockResolvedValue(true);
    const body = { action: "create", expectedRevision: 0, config, reason: "create" };
    expect((await POST(request(body))).status).toBe(200);
    const conflict = await POST(request(body));
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({ error: "profile_store_revision_conflict" });
  });
  it("rechecks Owner authority before committing a queued mutation", async () => {
    mock.live.mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const response = await POST(request({ action: "create", expectedRevision: 0, config, reason: "revoked during save" }));
    expect(response.status).toBe(403);
    mock.live.mockResolvedValue(true);
    expect((await (await GET()).json()).store.profiles).toEqual([]);
  });
  it("withholds the private response if Owner authority is withdrawn after commit", async () => {
    mock.live.mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const response = await POST(request({ action: "create", expectedRevision: 0, config, reason: "revoked after save" }));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "profile_owner_session_revoked" });
    mock.live.mockResolvedValue(true);
    expect((await (await GET()).json()).store.profiles).toHaveLength(1);
  });
});
