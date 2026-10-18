import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GATEWAY, fixture } from "./mso-gateway-test-fixture";

// `runtime-stop` is the internal quiesce step an in-place update calls for every
// inventoried origin. A healthy loopback listener that is proven to be THIS
// checkout's own mso.service is not a fallback runtime and must not dead-end the
// update; anything unproven must still fail closed.
function stopEnv(f: ReturnType<typeof fixture>, extra: Record<string, string> = {}) {
  const marker = path.join(f.dir, "restart-runtime");
  fs.writeFileSync(marker, "");
  return { ...f.baseEnv, MSO_GATEWAY_RECOVERY_MARKER: marker, ...extra };
}

describe("gateway update quiesce with a service-owned listener", () => {
  it("fails closed when the healthy responder is not proven to be this checkout's unit", () => {
    const f = fixture();
    const out = spawnSync(GATEWAY, ["runtime-stop"], { env: stopEnv(f), encoding: "utf8" });
    expect(out.status).not.toBe(0);
    expect(out.stderr).toContain("active but is not gateway-owned; stop it before an offline update");
    expect(out.stderr).not.toContain("runtime: service-owned");
  });

  it("reports runtime: service-owned and succeeds when the listener is proven to be the checkout's mso.service", () => {
    const f = fixture();
    const out = spawnSync(GATEWAY, ["runtime-stop"], {
      env: stopEnv(f, { NODE_ENV: "test", MSO_GATEWAY_TEST_SERVICE_LISTENER: "1" }),
      encoding: "utf8",
    });
    expect(out.status).toBe(0);
    expect(`${out.stdout}${out.stderr}`).toContain("runtime: service-owned");
  });

  it("keeps the offline preflight strict even when the quiesce seam is enabled", () => {
    const f = fixture();
    const out = spawnSync(GATEWAY, ["runtime-assert-update-safe"], {
      env: stopEnv(f, { NODE_ENV: "test", MSO_GATEWAY_TEST_SERVICE_LISTENER: "1" }),
      encoding: "utf8",
    });
    expect(out.status).not.toBe(0);
    expect(out.stderr).toContain("active but is not gateway-owned; stop it before an offline update");
  });
});
