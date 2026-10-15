import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const fixtures: string[] = [];
afterEach(() => { for (const dir of fixtures.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mso-tenant-cli-"));
  fs.chmodSync(root, 0o700);
  fixtures.push(root);
  const script = path.join(process.cwd(), "scripts/mso-tenant.ts");
  const env = { ...process.env, OS_TENANCY_STORAGE_ROOT: root, HOME: root };
  const run = (...args: string[]) => spawnSync(process.execPath.includes("bun") ? "bun" : "bun", [script, ...args], { encoding: "utf8", env, cwd: process.cwd() });
  return { root, env, run };
}
function token(stdout: string) {
  const match = /TENANT:[a-f0-9]+/.exec(stdout);
  if (!match) throw new Error("no preview token in output: " + stdout);
  return match[0];
}

describe("tenant enrollment CLI boundary", () => {
  it("refuses every action without a configured store root", () => {
    const run = spawnSync("bun", [path.join(process.cwd(), "scripts/mso-tenant.ts"), "status"], { encoding: "utf8", env: { ...process.env, OS_TENANCY_STORAGE_ROOT: "" } });
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("OS_TENANCY_STORAGE_ROOT");
  });

  it("init preview creates no state and refuses to overwrite an existing store", () => {
    const f = fixture();
    const preview = f.run("init");
    expect(preview.stdout).toContain("PREVIEW ONLY");
    expect(fs.existsSync(path.join(f.root, "state.json"))).toBe(false);
    const applied = f.run("init", "--apply", "--confirm", token(preview.stdout));
    expect(applied.status).toBe(0);
    expect(fs.existsSync(path.join(f.root, "state.json"))).toBe(true);
    const again = f.run("init", "--apply", "--confirm", "TENANT:whatever");
    expect(again.status).not.toBe(0);
    expect(again.stderr).toContain("already exists");
  });

  it("requires the exact current preview token before any enroll mutation", () => {
    const f = fixture(); f.run("init", "--apply", "--confirm", token(f.run("init").stdout));
    const enroll = ["enroll", "--issuer", "fixture", "--subject", "alice", "--tenant", "tenant-a", "--principal", "person-a"];
    expect(f.run(...enroll).stdout).toContain("PREVIEW ONLY");
    expect(f.run("list", "--json").stdout.trim()).toBe("[]");
    expect(f.run(...enroll, "--apply", "--confirm", "TENANT:deadbeef").status).not.toBe(0);
    expect(f.run("list", "--json").stdout.trim()).toBe("[]");
  });

  it("enrolls, guards remap, disables and lists a real binding with an audit trail", () => {
    const f = fixture(); f.run("init", "--apply", "--confirm", token(f.run("init").stdout));
    const enroll = (extra: string[] = []) => {
      const args = ["enroll", "--issuer", "fixture", "--subject", "alice", "--tenant", "tenant-a", "--principal", "person-a", ...extra];
      return f.run(...args, "--apply", "--confirm", token(f.run(...args).stdout));
    };
    expect(enroll().status).toBe(0);
    const rows = JSON.parse(f.run("list", "--json").stdout);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tenantId: "tenant-a", principalId: "person-a", enabled: true, tenantEnabled: true, mappingRevision: 1 });

    const remap = ["enroll", "--issuer", "fixture", "--subject", "alice", "--tenant", "tenant-b", "--principal", "person-b"];
    expect(f.run(...remap).status).not.toBe(0);
    expect(f.run(...remap, "--remap").stdout).toContain("PREVIEW ONLY");
    expect(f.run(...remap, "--remap", "--apply", "--confirm", token(f.run(...remap, "--remap").stdout)).status).toBe(0);

    const disable = ["set-enabled", "--issuer", "fixture", "--subject", "alice", "--enabled", "false"];
    expect(f.run(...disable, "--apply", "--confirm", token(f.run(...disable).stdout)).status).toBe(0);
    expect(JSON.parse(f.run("list", "--json").stdout)[0]).toMatchObject({ enabled: false, mappingRevision: 3 });

    const status = JSON.parse(f.run("status", "--json").stdout);
    expect(status).toMatchObject({ initialized: true, revision: 3, auditEntries: 3 });
  });

  it("surfaces the adapter guard when a principal is already bound elsewhere", () => {
    const f = fixture(); f.run("init", "--apply", "--confirm", token(f.run("init").stdout));
    const enroll = (subject: string) => {
      const args = ["enroll", "--issuer", "fixture", "--subject", subject, "--tenant", "tenant-a", "--principal", "person-a"];
      return f.run(...args, "--apply", "--confirm", token(f.run(...args).stdout));
    };
    expect(enroll("alice").status).toBe(0);
    const dup = enroll("bob");
    expect(dup.status).not.toBe(0);
    expect(dup.stderr).toContain("already bound");
  });

  it.each([["--issuer", "fixture"], ["enroll", "--subject", "alice", "--tenant", "t", "--principal", "p"]])("refuses an incomplete identifier set %j", (...args) => {
    const f = fixture(); f.run("init", "--apply", "--confirm", token(f.run("init").stdout));
    expect(f.run(...args).status).not.toBe(0);
  });
});

describe("tenant CLI is local-only", () => {
  it("refuses --base/--env targeting and never sources the env file", () => {
    const f = fixture();
    const marker = path.join(f.root, "sourced");
    fs.writeFileSync(path.join(f.root, "danger.env"), `touch '${marker}'\n`, { mode: 0o600 });
    const run = spawnSync("bash", [path.join(process.cwd(), "bin/mso"), "--env", path.join(f.root, "danger.env"), "tenant", "status"], { encoding: "utf8", env: { ...process.env, HOME: f.root } });
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("local-only");
    expect(fs.existsSync(marker)).toBe(false);
  });
});
