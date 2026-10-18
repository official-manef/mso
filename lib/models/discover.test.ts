import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeProviderFetch } from "../host/ssrf";
import {
  discoverEndpointModels,
  modelDiscoveryHeaders,
  modelsEndpoint,
  parseDiscoveredModels,
} from "./discover.js";

vi.mock("../host/ssrf", () => ({ safeProviderFetch: vi.fn() }));
const fetchModels = vi.mocked(safeProviderFetch);
beforeEach(() => { fetchModels.mockReset(); });

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

  it("always discovers through the pinned provider transport", async () => {
    fetchModels.mockResolvedValue(new Response(JSON.stringify({ data: [{ id: "gpt-oss" }] })));
    const models = await discoverEndpointModels(
      { baseUrl: "https://gateway.example/v1", apiKey: "sk-secret", protocol: "openai" },
    );
    expect(models).toEqual([{ id: "gpt-oss", name: "gpt-oss" }]);
    const [url, init] = fetchModels.mock.calls[0];
    expect(url).toBe("https://gateway.example/v1/models");
    expect(init).toMatchObject({ method: "GET", redirect: "error" });
    expect((init?.headers as Record<string, string>).authorization).toBe("Bearer sk-secret");
  });

  it("cancels provider errors without exposing an echoed credential", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream({ cancel });
    fetchModels.mockResolvedValue(new Response(body, { status: 401 }));
    await expect(
      discoverEndpointModels(
        { baseUrl: "https://gateway.example/v1", apiKey: "sk-secret" },
      ),
    ).rejects.toThrow(/^model discovery HTTP 401$/);
    expect(cancel).toHaveBeenCalledOnce();
    fetchModels.mockResolvedValue(new Response("Unauthorized: Bearer sk-secret", { status: 401 }));
    await expect(discoverEndpointModels({ baseUrl: "https://gateway.example/v1", apiKey: "sk-secret" }))
      .rejects.toThrow(/^model discovery HTTP 401$/);
  });

  it("rejects a non-JSON success body", async () => {
    fetchModels.mockResolvedValue(new Response("<html>", { status: 200 }));
    await expect(
      discoverEndpointModels(
        { baseUrl: "https://gateway.example/v1", apiKey: "sk-secret" },
      ),
    ).rejects.toThrow(/invalid JSON/);
  });

  it("does not expose a transport exception containing a credential", async () => {
    fetchModels.mockRejectedValue(new Error('invalid header: Bearer sk-secret'));
    await expect(discoverEndpointModels({ baseUrl: "https://gateway.example/v1", apiKey: "sk-secret" }))
      .rejects.toThrow(/^model discovery request failed$/);
  });

  it("rejects declared and streamed oversized model lists", async () => {
    const declaredCancel = vi.fn();
    fetchModels.mockResolvedValue(new Response(new ReadableStream({ cancel: declaredCancel }), {
      headers: { "content-length": String(3 * 1024 * 1024) },
    }));
    const connection = { baseUrl: "https://gateway.example/v1", apiKey: "sk-secret" };
    await expect(discoverEndpointModels(connection)).rejects.toThrow(/size limit/);
    expect(declaredCancel).toHaveBeenCalledOnce();
    const cancel = vi.fn();
    fetchModels.mockResolvedValue(new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1)); }, cancel,
    })));
    await expect(discoverEndpointModels(connection)).rejects.toThrow(/size limit/);
    expect(cancel).toHaveBeenCalledOnce();
  });
});
