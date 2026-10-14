#!/usr/bin/env bun
// Owner-only tenant enrollment control plane. Deliberately local, never an
// HTTP/MCP route or tool: it wraps the persistence adapter's trusted
// administration.setBinding, which is not reachable from any request path.
//
// Every mutation is PREVIEW ONLY unless --apply and --confirm <token> are both
// present. Inputs are owner-supplied at enrollment time; a tenant can never
// select its own directory, tenant ID, principal ID or provider. The store root
// comes from server-owned configuration (OS_TENANCY_STORAGE_ROOT), never argv.
import { createHash } from "node:crypto";
import { openTenantPersistence } from "../lib/tenancy/persistence";
import { tenantFile } from "../lib/tenancy/persistence-file";
import { validBinding, validId, validSubject } from "../lib/tenancy/persistence-schema";
import type { TenantSnapshot } from "../lib/tenancy/persistence-schema";

const HELP = `mso tenant — owner-only tenant enrollment (local installation only)

  mso tenant status
  mso tenant list [--json]
  mso tenant init
  mso tenant enroll --issuer <id> --subject <id> --tenant <id> --principal <id>
                    [--disabled] [--tenant-disabled] [--remap] [--json]
                    [--apply --confirm <preview-token>]
  mso tenant set-enabled --issuer <id> --subject <id> --tenant <id> --principal <id>
                    --enabled <true|false> [--tenant-enabled <true|false>]

Root comes from OS_TENANCY_STORAGE_ROOT (canonical absolute Linux directory, mode 0700,
owned by this service account). init creates only an empty snapshot and refuses when
state already exists. enroll/set-enabled are PREVIEW ONLY without --apply --confirm.

No credential value belongs in argv, the plan, the audit event or this help. Enrollment
authorizes a binding; it does NOT issue a credential or enable the runtime mode.
See docs/TENANT-ROLLOUT.md and docs/TENANT-PERSISTENCE.md.`;

type Options = Record<string, string | boolean | undefined>;
const argv = process.argv.slice(2);
const action = argv[0];
const flags: Options = {};
for (let i = 1; i < argv.length; i++) {
  const arg = argv[i];
  if (!arg.startsWith("--")) fail(`unexpected argument: ${arg}`);
  if (["--apply", "--json", "--disabled", "--tenant-disabled", "--remap"].includes(arg)) { flags[arg.slice(2)] = true; continue; }
  const value = argv[i + 1];
  if (value === undefined || value.startsWith("--")) fail(`${arg} needs a value`);
  flags[arg.slice(2)] = value; i++;
}
function fail(message: string): never { process.stderr.write(`mso tenant: ${message}\n`); process.exit(1); }
function str(name: string): string | undefined { const v = flags[name]; return typeof v === "string" ? v : undefined; }
function bool(name: string): boolean | undefined {
  const v = str(name); if (v === undefined) return undefined;
  if (v !== "true" && v !== "false") fail(`--${name} must be true or false`);
  return v === "true";
}
const root = process.env.OS_TENANCY_STORAGE_ROOT?.trim();

async function main() {
  if (!action || action === "help" || action === "--help" || action === "-h") { process.stdout.write(HELP + "\n"); return; }
  if (!root) fail("OS_TENANCY_STORAGE_ROOT is not set (server-owned store root)");

  if (action === "status") return status();
  if (action === "list") return list();
  if (action === "init") return init();
  if (action === "enroll") return setEnabled("enroll");
  if (action === "set-enabled") return setEnabled("set-enabled");
  fail(`unknown action: ${action} (see mso tenant --help)`);
}

async function status() {
  const store = await open();
  const s = await store.administration.status();
  emit({ root, initialized: true, revision: s.revision, auditEntries: s.auditEntries });
}

async function list() {
  const snapshot = await readSnapshot();
  emit(snapshot.bindings.map(b => ({
    issuer: b.issuer, subject: b.subject, tenantId: b.tenantId, principalId: b.principalId,
    mappingRevision: b.mappingRevision, enabled: b.enabled, tenantEnabled: b.tenantEnabled,
  })));
}

async function init() {
  const existing = await openSnapshotOrNull();
  if (existing) fail("tenant store already exists; init refuses to overwrite it");
  const plan = { action: "init", root };
  if (!confirmed(plan)) return preview(plan);
  await openTenantPersistence({ root: root!, initialize: true });
  emit({ action: "init", root, initialized: true });
}

async function setEnabled(mode: "enroll" | "set-enabled") {
  const issuer = str("issuer"), subject = str("subject"), tenantId = str("tenant"), principalId = str("principal");
  for (const [name, value] of [["issuer", issuer], ["subject", subject]] as const) {
    if (!value) fail(`--${name} is required`);
  }
  if (!validSubject({ issuer: issuer!, subject: subject! })) fail("--issuer/--subject must be bounded registry ids");
  const subjectKey = { issuer: issuer!, subject: subject! };

  const snapshot = await readSnapshot();
  const current = snapshot.bindings.find(b => b.issuer === issuer && b.subject === subject);

  let binding: { tenantId: string; principalId: string; enabled: boolean; tenantEnabled: boolean };
  if (mode === "enroll") {
    if (!tenantId || !principalId) fail("--tenant and --principal are required");
    if (!validId(tenantId) || !validId(principalId)) fail("--tenant/--principal must be bounded registry ids");
    binding = {
      tenantId, principalId,
      enabled: flags["disabled"] ? false : true,
      tenantEnabled: flags["tenant-disabled"] ? false : true,
    };
  } else {
    if (!current) fail("no existing binding for that issuer/subject; use `enroll`");
    binding = {
      tenantId: current.tenantId, principalId: current.principalId,
      enabled: bool("enabled") ?? current.enabled,
      tenantEnabled: bool("tenant-enabled") ?? current.tenantEnabled,
    };
    if (!validBinding({ ...binding, mappingRevision: 1 })) fail("resulting binding is invalid");
  }

  if (!validBinding({ ...binding, mappingRevision: 1 })) fail("binding is invalid");
  if (current && mode === "enroll"
    && (current.tenantId !== binding.tenantId || current.principalId !== binding.principalId)
    && !flags["remap"]) fail("subject is already bound to another tenant/principal; re-run with --remap to reassign"); 

  const plan = { action: mode, root, issuer, subject, binding, expectedRevision: snapshot.revision, replaces: current ? current.mappingRevision : null };
  if (!confirmed(plan)) return preview(plan);

  const store = await open();
  const live = await store.administration.status();
  if (live.revision !== plan.expectedRevision) fail("store changed since preview; re-run to get a fresh plan");
  const result = await store.administration.setBinding(subjectKey, binding, live.revision);
  emit({ action: mode, root, binding: result.result, revision: result.revision, operationId: result.operationId });
}

async function open() {
  const snapshot = await openSnapshotOrNull();
  if (!snapshot) fail("tenant store is not initialized at OS_TENANCY_STORAGE_ROOT");
  return await openTenantPersistence({ root: root!, initialize: false });
}
async function openSnapshotOrNull(): Promise<TenantSnapshot | null> {
  try { return await readSnapshot(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
async function readSnapshot(): Promise<TenantSnapshot> {
  const file = await tenantFile(root!);
  return file.transaction((directory) => file.read(directory));
}

function confirmation(plan: unknown) {
  return "TENANT:" + createHash("sha256").update(JSON.stringify(plan)).digest("hex").slice(0, 16);
}
function preview(plan: Record<string, unknown>) {
  const token = confirmation(plan);
  process.stdout.write("MSO tenant · PREVIEW ONLY\n" + JSON.stringify(plan, null, 2)
    + `\n\nNo state changed. Apply with:\n  --apply --confirm ${token}\n`);
}
function confirmed(plan: unknown) {
  if (!flags["apply"]) return false;
  const token = str("confirm");
  if (token !== confirmation(plan)) fail("--confirm token does not match the current plan");
  return true;
}
function emit(value: unknown) {
  if (flags["json"]) process.stdout.write(JSON.stringify(value, null, 2) + "\n");
  else process.stdout.write(format(value) + "\n");
}
function format(value: unknown): string {
  if (Array.isArray(value)) return value.length ? value.map(row => format(row)).join("\n") : "(no bindings)";
  if (value && typeof value === "object") return JSON.stringify(value);
  return String(value);
}

try { await main(); }
catch (error) { fail((error as Error).message); }
