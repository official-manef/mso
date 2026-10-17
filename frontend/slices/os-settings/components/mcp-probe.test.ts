import { afterEach, describe, expect, it, vi } from "vitest";
import { probeMcpConnection } from "./mcp-probe";
import type { McpProbeCheckId, McpProbeResult } from "./mcp-client-core";
import type { ProbeFetcher } from "./mcp-probe-request";

const origin = "https://mso.example.test";
const health = { status: "ok", service: "mso", version: "fixture", buildId: "fixture", runtimeInstanceId: "runtime-a" };
const oauth = {
  issuer: origin, authorization_endpoint: origin + "/oauth/authorize", token_endpoint: origin + "/oauth/token",
  registration_endpoint: origin + "/oauth/register", code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"],
};
const respond: ProbeFetcher = async (input, init) => {
  const url = String(input);
  if (url.endsWith("/api/health")) return Response.json(health);
  if (url.endsWith("/mcp") && init?.method === "POST") return new Response(null, {
    status: 401, headers: { "www-authenticate": 'Bearer realm="mso", resource_metadata="' + origin + '/.well-known/oauth-protected-resource"' },
  });
  if (url.endsWith("/mcp")) return Response.json({ name: "mso MCP", authorization_servers: [origin] });
  if (url.endsWith("oauth-protected-resource")) return Response.json({ resource: origin + "/mcp", authorization_servers: [origin] });
  return Response.json(oauth);
};
const check = (result: McpProbeResult, id: McpProbeCheckId) => result.checks.find(row => row.id === id);
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("MCP connection evidence", () => {
  it("keeps account selection and client cache unknown after server discovery passes", async () => {
    const fetcher = vi.fn(respond);
    const result = await probeMcpConnection(origin, fetcher);
    expect(result.ready).toBe(true);
    expect(result.checks).toHaveLength(8);
    for (const id of ["account", "client-tools"] as const) expect(check(result, id)).toMatchObject({ state: "unknown", ok: false });
    for (const id of ["server", "https", "mcp", "challenge", "resource", "oauth"] as const) expect(check(result, id)?.state).toBe("passed");
    expect(check(result, "challenge")?.httpStatus).toBe(401);
    expect(result.observedOrigin).toBe(origin);
    expect(result.configuredOrigin).toBe(origin);
    expect(Number.isNaN(Date.parse(result.checkedAt))).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(5);
    expect(fetcher.mock.calls.every(([, init]) => init?.credentials === "omit" && init.redirect === "error" && init.cache === "no-store")).toBe(true);
    expect(fetcher.mock.calls.every(([, init]) => !new Headers(init?.headers).has("authorization"))).toBe(true);
  });

  it("does not infer public HTTPS reachability from a successful loopback probe", async () => {
    const result = await probeMcpConnection(origin, respond, { observedOrigin: "http://127.0.0.1:4005" });
    expect(result.ready).toBe(true);
    expect(result.observedOrigin).toBe("http://127.0.0.1:4005");
    expect(check(result, "https")).toMatchObject({ state: "unknown" });
    expect(check(result, "https")?.guidance).toContain("configured HTTPS origin");
  });

  it("keeps HTTPS unknown for a local configured endpoint", async () => {
    const result = await probeMcpConnection("http://localhost:4005", respond);
    expect(check(result, "https")?.state).toBe("unknown");
  });

  it("reports server health separately when MCP is unavailable", async () => {
    const result = await probeMcpConnection(origin, async (input, init) =>
      String(input).endsWith("/mcp") ? new Response(null, { status: 404 }) : respond(input, init));
    expect(result.ready).toBe(false);
    expect(check(result, "server")?.state).toBe("passed");
    expect(check(result, "mcp")).toMatchObject({ state: "failed", httpStatus: 404 });
    expect(check(result, "mcp")?.guidance).toContain("MCP is enabled");
  });

  it("preserves healthy stages when one request fails", async () => {
    const result = await probeMcpConnection(origin, async (input, init) => {
      if (String(input).endsWith("oauth-authorization-server")) throw new TypeError("network");
      return respond(input, init);
    });
    expect(check(result, "oauth")).toMatchObject({ state: "failed", detail: "No response was received." });
    expect(check(result, "server")?.state).toBe("passed");
    expect(check(result, "resource")?.state).toBe("passed");
  });

  it.each([null, [], "metadata", { name: "mso MCP", authorization_servers: origin },
    { name: "mso MCP", authorization_servers: {} }].map(data => ({ data })))("rejects malformed descriptor $data without throwing", async ({ data }) => {
    const result = await probeMcpConnection(origin, (input, init) =>
      String(input).endsWith("/mcp") && init?.method !== "POST" ? Promise.resolve(Response.json(data)) : respond(input, init));
    expect(check(result, "mcp")?.state).toBe("failed");
    expect(check(result, "oauth")?.state).toBe("passed");
  });

  it("rejects string PKCE/auth-method values instead of matching substrings", async () => {
    const result = await probeMcpConnection(origin, (input, init) =>
      String(input).endsWith("oauth-authorization-server")
        ? Promise.resolve(Response.json({ ...oauth, code_challenge_methods_supported: "S256", token_endpoint_auth_methods_supported: "none" }))
        : respond(input, init));
    expect(check(result, "oauth")?.state).toBe("failed");
  });

  it("reports invalid JSON on only its own stage", async () => {
    const result = await probeMcpConnection(origin, (input, init) =>
      String(input).endsWith("/api/health") ? Promise.resolve(new Response("<html>unavailable</html>")) : respond(input, init));
    expect(check(result, "server")?.detail).toContain("valid JSON object");
    expect(check(result, "mcp")?.state).toBe("passed");
  });

  it("rejects a challenge and issuer for another deployment", async () => {
    const result = await probeMcpConnection(origin, (input, init) => {
      if (String(input).endsWith("/mcp") && init?.method === "POST") return Promise.resolve(new Response(null, {
        status: 401, headers: { "www-authenticate": 'Bearer resource_metadata="https://other.test/.well-known/oauth-protected-resource"' },
      }));
      if (String(input).endsWith("oauth-authorization-server")) return Promise.resolve(Response.json({ ...oauth, issuer: "https://other.test" }));
      return respond(input, init);
    });
    expect(check(result, "challenge")?.state).toBe("failed");
    expect(check(result, "oauth")?.state).toBe("failed");
  });

  it("detects a different runtime without inventing identity when none was supplied", async () => {
    const changed = await probeMcpConnection(origin, respond, { expectedRuntimeInstanceId: "runtime-b" });
    expect(changed.ready).toBe(false);
    expect(check(changed, "server")?.detail).toContain("runtime identity changed");
    expect(check(changed, "server")?.guidance).toContain("Reload Settings");
    expect(check(changed, "server")?.httpStatus).toBe(200);
    expect((await probeMcpConnection(origin, respond, { expectedRuntimeInstanceId: null })).ready).toBe(true);
  });

  it("retains liveness evidence but cannot verify a missing expected runtime identity", async () => {
    const result = await probeMcpConnection(origin, (input, init) =>
      String(input).endsWith("/api/health") ? Promise.resolve(Response.json({ ...health, runtimeInstanceId: null })) : respond(input, init),
    { expectedRuntimeInstanceId: "runtime-a" });
    expect(result.ready).toBe(false);
    expect(check(result, "server")).toMatchObject({ state: "unknown", httpStatus: 200 });
    expect(check(result, "server")?.detail).toContain("MSO responded");
  });

  it.each([true, false])("bounds oversized JSON with declared content length %s", async declared => {
    const result = await probeMcpConnection(origin, (input, init) => String(input).endsWith("/api/health")
      ? Promise.resolve(new Response("x".repeat(70_000), { headers: declared ? { "content-length": "70000" } : undefined })) : respond(input, init));
    expect(check(result, "server")?.detail).toContain("64 KiB");
    expect(check(result, "oauth")?.state).toBe("passed");
  });

  it("times out and aborts only the hanging stage even if its fetch ignores abort", async () => {
    vi.useFakeTimers();
    const stalled: (AbortSignal | null | undefined)[] = [];
    const pending = probeMcpConnection(origin, (input, init) => {
      if (String(input).endsWith("/mcp") && init?.method !== "POST") { stalled.push(init?.signal); return new Promise(() => {}); }
      return respond(input, init);
    }, { timeoutMs: 50 });
    await vi.advanceTimersByTimeAsync(50);
    const result = await pending;
    expect(check(result, "mcp")?.detail).toBe("This check timed out.");
    expect(check(result, "oauth")?.state).toBe("passed");
    expect(stalled[0]?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds a response whose JSON body never finishes", async () => {
    vi.useFakeTimers();
    const pending = probeMcpConnection(origin, (input, init) => {
      if (!String(input).endsWith("/api/health")) return respond(input, init);
      return Promise.resolve(new Response(new ReadableStream({ start(controller) {
        controller.enqueue(new TextEncoder().encode('{"status":'));
      } })));
    }, { timeoutMs: 50 });
    await vi.advanceTimersByTimeAsync(50);
    expect(check(await pending, "server")?.detail).toBe("This check timed out.");
  });

  it("cancels every stage and removes timers when the caller abandons a probe", async () => {
    vi.useFakeTimers();
    const controller = new AbortController(), signals: (AbortSignal | null | undefined)[] = [];
    const pending = probeMcpConnection(origin, (_input, init) => {
      signals.push(init?.signal); return new Promise(() => {});
    }, { signal: controller.signal });
    const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await rejected;
    expect(signals).toHaveLength(5);
    expect(signals.every(signal => signal?.aborted)).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not start requests for an already cancelled caller", async () => {
    const controller = new AbortController(), fetcher = vi.fn(respond);
    controller.abort();
    await expect(probeMcpConnection(origin, fetcher, { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
