import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  role: "owner" as string | null, get: vi.fn(), createSession: vi.fn(), run: vi.fn(), limited: vi.fn(),
}));
vi.mock("@/lib/auth/require-session", () => ({ getSessionContext: async () => mocks.role ? { role: mocks.role, session: { device_id: "fixture-device" } } : null }));
vi.mock("@/lib/host/limits-api", async (original) => ({ ...await original<typeof import("@/lib/host/limits-api")>(), rateLimited: mocks.limited }));
vi.mock("@/lib/agent/session-store", async (original) => ({ ...await original<typeof import("@/lib/agent/session-store")>(), createAgentSession: mocks.createSession }));
vi.mock("@/lib/workflow/graph-store", async (original) => ({ ...await original<typeof import("@/lib/workflow/graph-store")>(), getWorkflowGraph: mocks.get }));
vi.mock("@/lib/workflow/graph-engine", async (original) => ({ ...await original<typeof import("@/lib/workflow/graph-engine")>(), startWorkflowGraph: mocks.run }));
vi.mock("@/lib/mcp/scope", () => ({ maxScope: () => "exec" }));
vi.mock("@/lib/mcp/capability-runtime", () => ({ msoCapabilityRuntime: {} }));
vi.mock("@/lib/mcp/tools", () => ({ TOOLS_BY_NAME: new Map() }));

const { POST } = await import("./route");
const revision = "a".repeat(64);
const graph = { id: "graph-1", name: "First project check", revision };
const request = (extra: Record<string, unknown> = {}) => new NextRequest("http://localhost/api/v1/workflows", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ action: "run", graph_id: graph.id, input: {}, idempotency_key: "same-request", ...extra }),
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.role = "owner";
  mocks.limited.mockReturnValue(false);
  mocks.get.mockResolvedValue(graph);
  mocks.createSession.mockResolvedValue({ id: "session-1" });
  mocks.run.mockResolvedValue({ id: "run-1", state: "running" });
});

describe("reviewed workflow dispatch", () => {
  it("rejects a changed revision before creating either a session or run", async () => {
    const response = await POST(request({ expected_revision: "b".repeat(64) }));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "workflow graph revision changed; review it before running" });
    expect(mocks.createSession).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it.each([1, "", "a", { revision }, null])("rejects malformed revision %j", async (expected_revision) => {
    expect((await POST(request({ expected_revision }))).status).toBe(400);
    expect(mocks.createSession).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it("passes the reviewed snapshot and initiating principal to the existing runtime", async () => {
    expect((await POST(request({ expected_revision: revision }))).status).toBe(200);
    expect(mocks.get).toHaveBeenCalledWith("web:fixture-device", graph.id);
    expect(mocks.run).toHaveBeenCalledWith(graph, {}, "same-request", expect.objectContaining({ principal: "web:fixture-device", actor: "web:fixture-device", sessionId: "session-1" }), expect.any(Function));
  });

  it("preserves existing callers that do not provide an expected revision", async () => {
    expect((await POST(request())).status).toBe(200);
    expect(mocks.run).toHaveBeenCalledOnce();
  });

  it.each([null, "viewer"])("keeps the existing live role gate for %s", async (role) => {
    mocks.role = role;
    expect((await POST(request({ expected_revision: revision }))).status).toBe(403);
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.createSession).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
  });
});
