import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { discoverEndpointModels } from "./discover.js";

const mocks = vi.hoisted(() => ({ lookup: vi.fn(), httpsRequest: vi.fn(), httpRequest: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: mocks.lookup }));
vi.mock("node:https", () => ({ request: mocks.httpsRequest }));
vi.mock("node:http", () => ({ request: mocks.httpRequest }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("OS_CUSTOM_PROVIDER_ALLOW_INSECURE_HTTP", "0");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("unguarded fetch used"); }));
  mocks.lookup.mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

function upstream(status: number, body: string, headers = {}) {
  mocks.httpsRequest.mockImplementation((_options, callback) => {
    const request = new EventEmitter();
    return Object.assign(request, {
      end() {
        callback(Object.assign(Readable.from([Buffer.from(body)]), { statusCode: status, headers }));
        queueMicrotask(() => request.emit("close"));
      },
      destroy: vi.fn(),
    });
  });
}

describe("model discovery network boundary", () => {
  it.each(["", "fixture-key\nextra", "fixture-key\r", "fixture-key\u0000", "fixture-key\u0100"])(
    "rejects malformed credentials before request construction: %j", async (apiKey) => {
      await expect(discoverEndpointModels({ baseUrl: "https://api.example.com/v1", apiKey }))
        .rejects.toThrow(/^invalid model discovery API key$/);
      expect(mocks.lookup).not.toHaveBeenCalled();
      expect(mocks.httpsRequest).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    },
  );
  it.each(["https://127.0.0.1/v1", "https://169.254.169.254/v1", "https://[::1]/v1", "https://user:password@api.example.com/v1"])(
    "rejects an unsafe configured endpoint before opening a socket: %s", async (baseUrl) => {
      await expect(discoverEndpointModels({ baseUrl, apiKey: "fixture-key" })).rejects.toThrow();
      expect(mocks.lookup).not.toHaveBeenCalled();
      expect(mocks.httpsRequest).not.toHaveBeenCalled();
      expect(mocks.httpRequest).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("rejects a public hostname with any private DNS answer before sending credentials", async () => {
    mocks.lookup.mockResolvedValue([{ address: "8.8.8.8", family: 4 }, { address: "10.0.0.1", family: 4 }]);
    await expect(discoverEndpointModels({ baseUrl: "https://api.example.com/v1", apiKey: "fixture-key" }))
      .rejects.toThrow(/^model discovery request failed$/);
    expect(mocks.lookup).toHaveBeenCalledOnce();
    expect(mocks.httpsRequest).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("pins the validated address while preserving the provider host, path and credentials", async () => {
    upstream(200, '{"data":[{"id":"model-a"}]}');
    expect(await discoverEndpointModels({ baseUrl: "https://api.example.com/v1", apiKey: "fixture-key" }))
      .toEqual([{ id: "model-a", name: "model-a" }]);
    const [options] = mocks.httpsRequest.mock.calls[0];
    expect(options).toMatchObject({ hostname: "api.example.com", path: "/v1/models", headers: { authorization: "Bearer fixture-key" } });
    const callback = vi.fn();
    options.lookup("api.example.com", { all: true }, callback);
    expect(callback).toHaveBeenCalledWith(null, [{ address: "8.8.8.8", family: 4 }]);
    expect(mocks.lookup).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not follow redirects or return an upstream credential echo", async () => {
    upstream(302, "fixture-key", { location: "https://169.254.169.254/credentials" });
    await expect(discoverEndpointModels({ baseUrl: "https://api.example.com/v1", apiKey: "fixture-key" }))
      .rejects.toThrow(/^model discovery HTTP 302$/);
    expect(mocks.httpsRequest).toHaveBeenCalledOnce();
    expect(mocks.lookup).toHaveBeenCalledOnce();
    expect(mocks.httpRequest).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
