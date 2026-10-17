import os from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getRuntimeIdentity } from "./runtime-identity";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("private runtime identity", () => {
  it("does not infer the host environment from a production build", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OS_INSTANCE_ENVIRONMENT", undefined);
    vi.stubEnv("MSO_RUNTIME_INSTANCE_ID", undefined);
    vi.spyOn(os, "hostname").mockReturnValue("fixture-host");
    expect(getRuntimeIdentity()).toEqual({
      hostname: "fixture-host", serviceUser: os.userInfo().username, runtimeInstanceId: null, environment: null,
    });
  });

  it.each(["development", "test", "staging", "production"])("returns the explicitly declared %s role", environment => {
    vi.stubEnv("OS_INSTANCE_ENVIRONMENT", environment);
    vi.stubEnv("MSO_RUNTIME_INSTANCE_ID", "runtime-restart-proof");
    expect(getRuntimeIdentity()).toMatchObject({ environment, runtimeInstanceId: "runtime-restart-proof" });
  });

  it("leaves an invalid environment and an unavailable service user unknown", () => {
    vi.stubEnv("OS_INSTANCE_ENVIRONMENT", "prod");
    vi.spyOn(os, "userInfo").mockImplementation(() => { throw new Error("passwd entry unavailable"); });
    expect(getRuntimeIdentity()).toMatchObject({ serviceUser: null, environment: null });
  });
});
