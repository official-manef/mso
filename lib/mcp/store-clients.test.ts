import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

const DIR = path.join(os.tmpdir(), `mso-mcp-clients-test-${process.pid}`);
process.env.OS_MCP_STORE = path.join(DIR, "mcp.json");

const store = await import("./store-clients");

beforeEach(async () => {
  await fs.rm(DIR, { recursive: true, force: true });
});
afterAll(async () => {
  await fs.rm(DIR, { recursive: true, force: true });
});

describe("on-demand client registration", () => {
  it("registers a self-declared public client id, unions redirects, and refuses reserved principals", async () => {
    const first = await store.ensureClient("chatgpt-user-defined", ["https://chatgpt.com/cb"], "ChatGPT");
    expect(first).toMatchObject({ name: "ChatGPT", redirectUris: ["https://chatgpt.com/cb"] });
    expect(await store.getClient("chatgpt-user-defined")).toMatchObject({ name: "ChatGPT" });

    // A reconnect may present an additional callback; the client keeps its identity.
    const again = await store.ensureClient("chatgpt-user-defined", ["https://chatgpt.com/cb", "http://localhost:1455/cb"]);
    expect(again.redirectUris).toEqual(["https://chatgpt.com/cb", "http://localhost:1455/cb"]);

    await expect(store.ensureClient("manual:pat:other-owner", ["https://x.example/cb"])).rejects.toThrow(/reserved/);
    await expect(store.ensureClient("mso_code_leak", ["https://x.example/cb"])).rejects.toThrow(/reserved/);
  });

  it("classifies auto-registerable ids and rejects reserved or malformed ones", () => {
    expect(store.isAutoRegisterableClientId("chatgpt-mso")).toBe(true);
    expect(store.isAutoRegisterableClientId("mcpc_abc123")).toBe(true);
    expect(store.isAutoRegisterableClientId("manual:pat:x")).toBe(false);
    expect(store.isAutoRegisterableClientId("pat:x")).toBe(false);
    expect(store.isAutoRegisterableClientId("mso_refresh_x")).toBe(false);
    expect(store.isAutoRegisterableClientId("")).toBe(false);
    expect(store.isAutoRegisterableClientId("has space")).toBe(false);
  });
});
