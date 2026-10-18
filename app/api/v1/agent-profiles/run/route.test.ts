import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ auth: vi.fn(), run: vi.fn(), limited: vi.fn() }));
vi.mock("@/lib/auth/require-session", () => ({ getSessionContext: mock.auth }));
vi.mock("@/lib/agent/profile-runtime", () => ({ runAgentProfile: mock.run }));
vi.mock("@/lib/mcp/capability-runtime", () => ({ msoCapabilityRuntime: { list: () => [], invoke: vi.fn() } }));
vi.mock("@/lib/host/rate-limit", () => ({ rateLimited: mock.limited }));
const { POST } = await import("./route");
const { AgentProfileError } = await import("@/lib/agent/profile-schema");
const auth = { session: { device_id: "aaaaaaaaaaaaaaaa" }, role: "owner" };
const request = (body: unknown = { profileId: "profile-fixture", profileRevision: 1, prompt: "read" }) => new Request("https://mso.invalid/api/v1/agent-profiles/run", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => { Object.values(mock).forEach(fn => fn.mockReset()); mock.auth.mockResolvedValue(auth); mock.limited.mockReturnValue(false); mock.run.mockResolvedValue({ runId: "fixture", status: "completed" }); });

describe("profile task HTTP admission", () => {
  it.each([null, { ...auth, role: "operator" }, { ...auth, role: "viewer" }])("requires Owner before running: %j", async context => {
    mock.auth.mockResolvedValue(context);
    expect((await POST(request())).status).toBe(context ? 403 : 401);
    expect(mock.run).not.toHaveBeenCalled();
  });
  it("passes the authenticated session and request cancellation to the runner", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mock.run).toHaveBeenCalledWith(expect.objectContaining({ session: auth.session, signal: expect.any(AbortSignal) }));
  });
  it("refuses a simultaneous task on the same device, then admits work after completion", async () => {
    let complete!: (value: unknown) => void;
    mock.run.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const first = POST(request());
    await vi.waitFor(() => expect(mock.run).toHaveBeenCalledTimes(1));
    expect((await POST(request())).status).toBe(409);
    complete({ status: "completed" }); await first;
    expect((await POST(request())).status).toBe(200);
  });
  it("bounds body size and rate without starting a model request", async () => {
    expect((await POST(request({ prompt: "x".repeat(17000) }))).status).toBe(413);
    mock.limited.mockReturnValue(true);
    const response = await POST(request());
    expect(response.status).toBe(429); expect(response.headers.get("retry-after")).toBe("60");
    expect(mock.run).not.toHaveBeenCalled();
  });
  it("exposes expected conflicts but sanitizes unexpected provider or filesystem errors", async () => {
    mock.run.mockRejectedValueOnce(new AgentProfileError("profile_revision_conflict", 409));
    expect((await POST(request())).status).toBe(409);
    mock.run.mockRejectedValueOnce(new Error("provider-key-fixture /private/path"));
    const response = await POST(request());
    expect(response.status).toBe(502); expect(await response.json()).toEqual({ error: "profile_run_failed" });
  });
});
