import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth/require-session";

const mocks = vi.hoisted(() => ({
  readConfig: vi.fn(),
  getKey: vi.fn(),
  safeProviderId: vi.fn(),
  discoverEndpointModels: vi.fn(),
  assertSafeUrl: vi.fn(),
  safeProviderFetch: vi.fn(),
}));
const { readConfig, getKey, safeProviderId, discoverEndpointModels, assertSafeUrl, safeProviderFetch } = mocks;

vi.mock("@/lib/auth/require-session", () => ({ requireSession: vi.fn(async () => true) }));
vi.mock("@/lib/config/store", () => ({
  readConfig: mocks.readConfig,
  hostCredentialStore: () => ({ getKey: mocks.getKey }),
  safeProviderId: mocks.safeProviderId,
}));
vi.mock("@/lib/models/discover.js", () => ({ discoverEndpointModels: mocks.discoverEndpointModels }));
vi.mock("@/lib/host/ssrf", () => ({
  assertSafeUrl: mocks.assertSafeUrl,
  safeProviderFetch: mocks.safeProviderFetch,
}));

const post = (body: unknown) =>
  new NextRequest("http://localhost/api/models/discover", {
    method: "POST",
    body: JSON.stringify(body),
  });

describe("/api/models/discover", () => {
  beforeEach(() => {
    vi.mocked(requireSession).mockReset().mockResolvedValue(true);
    readConfig.mockReset().mockResolvedValue({});
    getKey.mockReset().mockResolvedValue("stored-key");
    safeProviderId.mockReset().mockImplementation((v: string) => v);
    discoverEndpointModels.mockReset().mockResolvedValue([{ id: "gpt-oss", name: "gpt-oss" }]);
    assertSafeUrl.mockReset().mockImplementation((raw: string) => new URL(raw));
  });

  it("requires Owner before reading config or touching a URL", async () => {
    vi.mocked(requireSession).mockResolvedValue(false);
    const { POST } = await import("./route");
    const res = await POST(post({ baseURL: "https://gateway.example/v1", apiKey: "sk-secret" }));
    expect(res.status).toBe(401);
    expect(requireSession).toHaveBeenCalledWith("owner");
    expect(discoverEndpointModels).not.toHaveBeenCalled();
    expect(assertSafeUrl).not.toHaveBeenCalled();
    expect(readConfig).not.toHaveBeenCalled();
  });

  it("rejects a malformed body with 400 before any network access", async () => {
    const { POST } = await import("./route");
    for (const body of [null, [], { protocol: "nope" }, { baseURL: 5 }, { apiKey: true }]) {
      expect((await POST(post(body))).status).toBe(400);
    }
    expect(discoverEndpointModels).not.toHaveBeenCalled();
  });

  it("discovers inline credentials through the pinned transport and never echoes the key", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      post({ baseURL: "https://gateway.example/v1/", apiKey: "sk-secret", protocol: "anthropic" }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, count: 1, models: [{ id: "gpt-oss", name: "gpt-oss" }] });
    expect(JSON.stringify(body)).not.toContain("sk-secret");
    expect(assertSafeUrl).toHaveBeenCalledWith("https://gateway.example/v1/");
    expect(discoverEndpointModels).toHaveBeenCalledWith(
      { baseUrl: "https://gateway.example/v1", apiKey: "sk-secret", protocol: "anthropic" },
      { fetchImpl: safeProviderFetch },
    );
  });

  it("defaults the inline protocol to openai", async () => {
    const { POST } = await import("./route");
    await POST(post({ baseURL: "https://gateway.example/v1", apiKey: "sk-secret" }));
    expect(discoverEndpointModels).toHaveBeenCalledWith(
      { baseUrl: "https://gateway.example/v1", apiKey: "sk-secret", protocol: "openai" },
      { fetchImpl: safeProviderFetch },
    );
  });

  it("requires baseURL and apiKey for the inline path", async () => {
    const { POST } = await import("./route");
    expect((await POST(post({ baseURL: "https://gateway.example/v1" }))).status).toBe(400);
    expect((await POST(post({ apiKey: "sk" }))).status).toBe(400);
    expect(discoverEndpointModels).not.toHaveBeenCalled();
  });

  it("maps an unsafe URL to 400 without fetching", async () => {
    assertSafeUrl.mockImplementation(() => {
      throw new Error("Base URL must use HTTPS");
    });
    const { POST } = await import("./route");
    const res = await POST(post({ baseURL: "http://169.254.169.254/v1", apiKey: "sk" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Base URL must use HTTPS" });
    expect(discoverEndpointModels).not.toHaveBeenCalled();
  });

  it("discovers a saved provider using the host-stored key", async () => {
    readConfig.mockResolvedValue({
      customProviders: { "my-llm": { baseUrl: "https://gw.example/v1", protocol: "anthropic" } },
    });
    getKey.mockResolvedValue("stored-key");
    const { POST } = await import("./route");
    const res = await POST(post({ provider: "my-llm" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, count: 1, models: [{ id: "gpt-oss", name: "gpt-oss" }] });
    expect(getKey).toHaveBeenCalledWith(undefined, "my-llm");
    expect(assertSafeUrl).not.toHaveBeenCalled();
    expect(discoverEndpointModels).toHaveBeenCalledWith(
      { baseUrl: "https://gw.example/v1", apiKey: "stored-key", protocol: "anthropic" },
      { fetchImpl: safeProviderFetch },
    );
  });

  it("rejects an unknown custom provider with 400", async () => {
    readConfig.mockResolvedValue({ customProviders: {} });
    const { POST } = await import("./route");
    const res = await POST(post({ provider: "nope" }));
    expect(res.status).toBe(400);
    expect(discoverEndpointModels).not.toHaveBeenCalled();
  });

  it("maps a provider-id validation failure to 400", async () => {
    safeProviderId.mockImplementation(() => {
      throw new Error("invalid provider id");
    });
    const { POST } = await import("./route");
    expect((await POST(post({ provider: "bad id" }))).status).toBe(400);
    expect(discoverEndpointModels).not.toHaveBeenCalled();
  });

  it("reports a missing stored key without calling the endpoint", async () => {
    readConfig.mockResolvedValue({ customProviders: { "my-llm": { baseUrl: "https://gw.example/v1" } } });
    getKey.mockResolvedValue(null);
    const { POST } = await import("./route");
    const res = await POST(post({ provider: "my-llm" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: false, error: expect.stringContaining("no stored API key") });
    expect(discoverEndpointModels).not.toHaveBeenCalled();
  });

  it("surfaces a discovery failure as ok:false without leaking the key", async () => {
    discoverEndpointModels.mockRejectedValue(new Error("model discovery HTTP 401"));
    const { POST } = await import("./route");
    const res = await POST(post({ baseURL: "https://gw.example/v1", apiKey: "sk-secret" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: false, error: "model discovery HTTP 401" });
    expect(JSON.stringify(body)).not.toContain("sk-secret");
  });
});
