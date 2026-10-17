import { describe, expect, it, vi } from "vitest";
import {
  discoverEndpointModels,
  modelDiscoveryHeaders,
  modelsEndpoint,
  parseDiscoveredModels,
} from "./discover.js";

describe("endpoint model discovery", () => {
  it("builds the list URL per protocol and avoids a doubled /v1", () => {
    expect(modelsEndpoint("https://gateway.example/v1", "openai")).toBe("https://gateway.example/v1/models");
    expect(modelsEndpoint("https://gateway.example/v1/", "openai")).toBe("https://gateway.example/v1/models");
    expect(modelsEndpoint("https://api.anthropic.com", "anthropic")).toBe("https://api.anthropic.com/v1/models");
    expect(modelsEndpoint("https://proxy.example/v1", "anthropic")).toBe("https://proxy.example/v1/models");
  });

  it("sends each protocol's native auth header", () => {
    expect(modelDiscoveryHeaders("openai", "sk-secret")).toEqual({
      accept: "application/json",
      authorization: "Bearer sk-secret",
    });
    expect(modelDiscoveryHeaders("anthropic", "sk-secret")).toEqual({
      accept: "application/json",
      "x-api-key": "sk-secret",
      "anthropic-version": "2023-06-01",
    });
  });

  it("parses the common list shapes and prefers a display name", () => {
    expect(parseDiscoveredModels({ data: [{ id: "b" }, { id: "a", name: "Model A" }] }))
      .toEqual([{ id: "a", name: "Model A" }, { id: "b", name: "b" }]);
    expect(parseDiscoveredModels({ models: ["z", "a", "a"] }))
      .toEqual([{ id: "a", name: "a" }, { id: "z", name: "z" }]);
    expect(parseDiscoveredModels(["only"])).toEqual([{ id: "only", name: "only" }]);
    expect(parseDiscoveredModels({ unexpected: true })).toEqual([]);
    expect(parseDiscoveredModels(null)).toEqual([]);
  });

  it("discovers through the injected fetch, without leaking the key elsewhere", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify({ data: [{ id: "gpt-oss" }] }), { status: 200 }),
    );
    const models = await discoverEndpointModels(
      { baseUrl: "https://gateway.example/v1", apiKey: "sk-secret", protocol: "openai" },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(models).toEqual([{ id: "gpt-oss", name: "gpt-oss" }]);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://gateway.example/v1/models");
    expect(init).toMatchObject({ method: "GET", redirect: "error" });
    expect((init?.headers as Record<string, string>).authorization).toBe("Bearer sk-secret");
  });

  it("surfaces a bounded provider error instead of the response body", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response("denied ".repeat(1000), { status: 401 }),
    );
    await expect(
      discoverEndpointModels(
        { baseUrl: "https://gateway.example/v1", apiKey: "sk-secret" },
        { fetchImpl: fetchImpl as unknown as typeof fetch },
      ),
    ).rejects.toThrow(/model discovery HTTP 401/);
  });

  it("rejects a non-JSON success body", async () => {
    const fetchImpl = vi.fn(async () => new Response("<html>", { status: 200 }));
    await expect(
      discoverEndpointModels(
        { baseUrl: "https://gateway.example/v1", apiKey: "sk-secret" },
        { fetchImpl: fetchImpl as unknown as typeof fetch },
      ),
    ).rejects.toThrow(/invalid JSON/);
  });
});
