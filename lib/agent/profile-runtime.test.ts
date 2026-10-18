import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { SessionPayload } from "@/lib/auth/session";

const mock = vi.hoisted(() => ({ authorized: vi.fn(), prepare: vi.fn(), stream: vi.fn(), create: vi.fn(), event: vi.fn(), history: vi.fn(), invoke: vi.fn() }));
vi.mock("@/lib/auth/live-authorization", () => ({ liveSessionAuthorized: mock.authorized }));
vi.mock("@/lib/auth/device-store", () => ({ getApprovedDevice: async () => ({ role: "owner" }) }));
vi.mock("@/lib/ai/selected-model-stream", () => ({ prepareSelectedModel: mock.prepare, streamPreparedSelectedModel: mock.stream }));
vi.mock("./session-store", () => ({ createAgentSession: mock.create, appendAgentSessionEvent: mock.event, updateAgentSessionHistory: mock.history }));
const { mutateAgentProfiles } = await import("./profile-store");
const { agentProfileFile } = await import("./profile-storage");
const { runAgentProfile, profileRuntimeAuthority } = await import("./profile-runtime");
const session = { device_id: "aaaaaaaaaaaaaaaa" } as SessionPayload;
const owner = `web:${session.device_id}`;
const config = { name: "Reader", avatar: "", instructions: "Show concise findings.", runtime: "mso-readonly", model: { provider: "selected-account", model: "exact-model" }, tools: ["fs_read"] };
const capability = (name: string, scope: "read" | "exec") => ({ name, scope, description: name, inputSchema: { type: "object" as const, properties: {} } });
const capabilities = { list: () => [capability("fs_read", "read"), capability("vps_status", "read"), capability("exec_run", "exec")], invoke: mock.invoke };
let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "mso-profile-run-")); vi.stubEnv("OS_AGENT_PROFILES_DIR", root);
  Object.values(mock).forEach(fn => fn.mockReset()); mock.authorized.mockResolvedValue(true); mock.prepare.mockResolvedValue({});
  mock.create.mockResolvedValue({ id: "run-fixture" }); mock.invoke.mockResolvedValue({ content: [{ type: "text", text: "source evidence" }] });
  mock.event.mockResolvedValue(undefined); mock.history.mockResolvedValue(undefined);
});
afterEach(async () => { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); });
async function profile() { return (await mutateAgentProfiles(owner, { action: "create", expectedRevision: 0, config, reason: "Create reader" })).profiles[0]; }
const run = (id: string) => runAgentProfile({ session, body: { profileId: id, profileRevision: 1, prompt: "Inspect source" }, capabilities, signal: new AbortController().signal });

describe("server execution of saved profiles", () => {
  it("uses the saved exact model, limits the kernel call, and writes native receipts", async () => {
    const saved = await profile();
    mock.stream.mockImplementationOnce(async ({ tools, emit, system }) => {
      expect(tools.map((tool: { name: string }) => tool.name)).toEqual(["fs_read"]);
      expect(system).toContain(config.instructions);
      emit("tool_use", { id: "read", name: "fs_read", input: { path: "/project/source.ts", owner: "different", scope: "exec" } });
    }).mockImplementationOnce(async ({ emit }) => emit("delta", "Verified source"));
    expect(await run(saved.id)).toMatchObject({ profileId: saved.id, profileRevision: 1, model: config.model, status: "completed", text: "Verified source", rounds: 2, toolCalls: [{ name: "fs_read", ok: true }] });
    expect(mock.prepare).toHaveBeenCalledWith(config.model);
    expect(mock.invoke).toHaveBeenCalledWith(expect.objectContaining({ principal: owner, actor: owner, scope: "read", allowedTools: ["fs_read"], sessionId: "run-fixture", liveAuthorization: expect.any(Function) }));
    expect(mock.create).toHaveBeenCalledWith(owner, "alfa", expect.objectContaining({ memorySnapshot: expect.objectContaining({ user: "", memory: "", recordCount: 0 }) }));
    expect(mock.history).toHaveBeenCalledWith(owner, "run-fixture", expect.arrayContaining([expect.objectContaining({ role: "tool" })]));
    expect(mock.event).toHaveBeenLastCalledWith(owner, "run-fixture", expect.objectContaining({ state: "completed", detail: expect.stringContaining("revision 1") }));
  });
  it("denies unassigned reads and mutations even when the model calls unseen names", async () => {
    const saved = await profile();
    mock.stream.mockImplementationOnce(async ({ emit }) => {
      emit("tool_use", { id: "one", name: "vps_status", input: {} });
      emit("tool_use", { id: "two", name: "exec_run", input: {} });
    }).mockImplementationOnce(async ({ emit }) => emit("delta", "Unavailable"));
    const result = await run(saved.id);
    expect(result.toolCalls).toEqual([{ name: "vps_status", ok: false }, { name: "exec_run", ok: false }]);
    expect(mock.invoke).not.toHaveBeenCalled();
    const authority = profileRuntimeAuthority(session, saved, capabilities);
    await expect(authority.runtime.invoke({ name: "exec_run", scope: "exec", allowedTools: ["exec_run"] })).rejects.toThrow("profile_tool_denied");
  });
  it.each(["edit", "disable", "revoke"])("stops a %s during model execution before any tool starts", async action => {
    const saved = await profile();
    mock.stream.mockImplementationOnce(async ({ emit }) => {
      if (action === "revoke") mock.authorized.mockResolvedValue(false);
      else await mutateAgentProfiles(owner, { action, expectedRevision: 1, id: saved.id, profileRevision: 1, config: { ...config, tools: [] }, reason: "Withdraw permission" });
      emit("tool_use", { id: "read", name: "fs_read", input: {} });
    });
    await expect(run(saved.id)).rejects.toThrow(/profile_(revision_conflict|disabled|owner_session_revoked)/);
    expect(mock.invoke).not.toHaveBeenCalled();
    expect(mock.event).toHaveBeenLastCalledWith(owner, "run-fixture", expect.objectContaining({ state: "failed" }));
  });
  it("stops before the next model turn when the owner grant changes during a read", async () => {
    const saved = await profile();
    mock.stream.mockImplementationOnce(async ({ emit }) => emit("tool_use", { id: "read", name: "fs_read", input: {} }));
    mock.invoke.mockImplementationOnce(async () => { mock.authorized.mockResolvedValue(false); return { content: [] }; });
    await expect(run(saved.id)).rejects.toThrow("profile_owner_session_revoked");
    expect(mock.stream).toHaveBeenCalledTimes(1);
  });
  it("rejects client-supplied policy and cross-device profile identifiers", async () => {
    const saved = await profile();
    await expect(runAgentProfile({ session, body: { profileId: saved.id, profileRevision: 1, prompt: "inspect", tools: ["exec_run"] }, capabilities, signal: new AbortController().signal })).rejects.toThrow("unsupported_profile_field");
    await expect(runAgentProfile({ session: { device_id: "bbbbbbbbbbbbbbbb" } as SessionPayload, body: { profileId: saved.id, profileRevision: 1, prompt: "inspect" }, capabilities, signal: new AbortController().signal })).rejects.toThrow("profile_not_found");
    expect(mock.prepare).not.toHaveBeenCalled();
  });
  it("honors cancellation before model or tool dispatch", async () => {
    const saved = await profile(), abort = new AbortController(); abort.abort(new Error("cancelled"));
    await expect(runAgentProfile({ session, body: { profileId: saved.id, profileRevision: 1, prompt: "inspect" }, capabilities, signal: abort.signal })).rejects.toThrow("cancelled");
    expect(mock.stream).not.toHaveBeenCalled(); expect(mock.invoke).not.toHaveBeenCalled();
  });
  it.each(["history", "event"] as const)("withholds the final response when authority is withdrawn during %s persistence", async persistence => {
    const saved = await profile();
    mock.stream.mockImplementationOnce(async ({ emit }) => emit("delta", "private final response"));
    mock[persistence].mockImplementationOnce(async () => { mock.authorized.mockResolvedValue(false); });
    await expect(run(saved.id)).rejects.toThrow("profile_owner_session_revoked");
    expect(mock.event).toHaveBeenLastCalledWith(owner, "run-fixture", expect.objectContaining({ state: "failed" }));
  });
  it("honors cancellation during persistence before returning the final response", async () => {
    const saved = await profile(), abort = new AbortController();
    mock.stream.mockImplementationOnce(async ({ emit }) => emit("delta", "private response"));
    mock.history.mockImplementationOnce(async () => abort.abort(new Error("cancelled after history")));
    await expect(runAgentProfile({ session, body: { profileId: saved.id, profileRevision: 1, prompt: "inspect" }, capabilities, signal: abort.signal })).rejects.toThrow("cancelled after history");
  });
  it("stops when the saved policy disappears during a model round", async () => {
    const saved = await profile();
    mock.stream.mockImplementationOnce(async ({ emit }) => {
      await rm(agentProfileFile(owner)); emit("delta", "private response");
    });
    await expect(run(saved.id)).rejects.toThrow("profile_not_found");
    expect(mock.invoke).not.toHaveBeenCalled();
  });
  it("retains completed tool results and closes pending calls at the sixteen-call limit", async () => {
    const saved = await profile();
    mock.stream.mockImplementationOnce(async ({ emit }) => {
      for (let index = 0; index < 17; index++) emit("tool_use", { id: `read-${index}`, name: "fs_read", input: {} });
    });
    const result = await run(saved.id);
    expect(result.status).toBe("partial"); expect(result.toolCalls).toHaveLength(16);
    expect(mock.invoke).toHaveBeenCalledTimes(16); expect(mock.stream).toHaveBeenCalledTimes(1);
    const history = mock.history.mock.calls[0][2];
    const results = history.find((message: { role: string }) => message.role === "tool").results;
    expect(results).toHaveLength(17);
    expect(results.slice(0, 16).every((entry: { content: string }) => entry.content === "source evidence")).toBe(true);
    expect(results[16]).toMatchObject({ id: "read-16", isError: true, content: expect.stringContaining("not executed") });
  });
});
