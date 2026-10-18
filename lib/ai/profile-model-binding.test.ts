import { beforeEach, describe, expect, it, vi } from "vitest";
import { PROVIDERS } from "@/lib/models";

const mock = vi.hoisted(() => ({ config: vi.fn(), key: vi.fn(), selected: vi.fn(), ref: vi.fn(), oauth: vi.fn(), refresh: vi.fn(), save: vi.fn() }));
vi.mock("@/lib/config/store", () => ({ DEFAULT_PROVIDER: "anthropic", readConfig: mock.config,
  safeProviderId: (id: string) => id, hostCredentialStore: () => ({ getKey: mock.key }),
  selectedCustomConn: mock.selected, resolveModelRef: mock.ref, readOAuthBundle: mock.oauth, writeOAuthBundle: mock.save }));
vi.mock("@/lib/ai/oauth/codex", () => ({ ensureFreshCodex: mock.refresh }));
const { prepareSelectedModel } = await import("./selected-model-stream");
const active = { baseUrl: "https://active.invalid/v1", protocol: "openai" }, saved = { baseUrl: "https://saved.invalid/v1", protocol: "anthropic" };
beforeEach(() => {
  Object.values(mock).forEach(fn => fn.mockReset());
  mock.config.mockResolvedValue({ provider: "active", model: "active-model", customProviders: { active, saved } });
  mock.key.mockImplementation(async (_tenant: unknown, provider: string) => `fixture-key:${provider}`);
  mock.selected.mockResolvedValue(active); mock.ref.mockResolvedValue("active/active-model");
});
describe("saved profile model binding", () => {
  it("pairs the saved provider's key and endpoint and preserves namespaced model ids", async () => {
    const prepared = await prepareSelectedModel({ provider: "saved", model: "organization/exact-model" });
    expect(prepared).toMatchObject({ kind: "anthropic", provider: "saved", model: "organization/exact-model", customProvider: true,
      resolved: { provider: "saved", model: "organization/exact-model", baseUrl: saved.baseUrl, apiKey: "fixture-key:saved" } });
    expect(mock.key).toHaveBeenCalledWith(undefined, "saved");
    expect(mock.selected).not.toHaveBeenCalled(); expect(mock.ref).not.toHaveBeenCalled();
  });
  it("keeps known provider endpoints pinned while honoring the exact saved model", async () => {
    const prepared = await prepareSelectedModel({ provider: "openai", model: "explicit-account-model" });
    expect(prepared).toMatchObject({ provider: "openai", model: "explicit-account-model", resolved: { baseUrl: PROVIDERS.openai.baseUrl, apiKey: "fixture-key:openai" } });
  });
  it("preserves the deployment-selected path for existing callers without a binding", async () => {
    expect(await prepareSelectedModel()).toMatchObject({ provider: "active", model: "active-model", resolved: { baseUrl: active.baseUrl } });
    expect(mock.selected).toHaveBeenCalledTimes(1); expect(mock.ref).toHaveBeenCalledTimes(1);
  });
  it("uses the existing Codex authority with the explicitly saved account model", async () => {
    const bundle = { kind: "oauth", access: "fixture-access", expires: 100 };
    mock.oauth.mockResolvedValue(bundle); mock.refresh.mockResolvedValue(bundle);
    expect(await prepareSelectedModel({ provider: "openai-codex", model: "account/model" })).toEqual({ kind: "codex", provider: "openai-codex", model: "account/model", bundle });
    expect(mock.oauth).toHaveBeenCalledWith("openai-codex"); expect(mock.key).not.toHaveBeenCalled();
  });
  it("does not fall back to another provider when the saved connection is absent", async () => {
    mock.key.mockResolvedValue(null);
    await expect(prepareSelectedModel({ provider: "saved", model: "exact" })).rejects.toMatchObject({ code: "no_api_key:saved", status: 501 });
    expect(mock.selected).not.toHaveBeenCalled(); expect(mock.ref).not.toHaveBeenCalled();
  });
});
