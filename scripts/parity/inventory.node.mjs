import { test } from "node:test";
import "./artifacts.node.mjs";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readInventory, validateInventory } from "./inventory.mjs";
import { validateSources } from "./sources.mjs";
import { safeFile } from "./paths.mjs";
import { candidateHead, validateCandidateMappings } from "./candidate.mjs";
import { validateEvidence } from "./evidence.mjs";
import { requiredVariants } from "./variants.mjs";
import { evidenceFixture } from "./fixtures.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const { inventory, implementation, sources } = readInventory(root);
const clone = value => structuredClone(value);
function fixture(t) { const result = evidenceFixture(inventory, implementation); t.after(() => rmSync(result.root, { recursive: true, force: true })); return result; }
const check = f => validateEvidence(inventory, f.implementation, f.evidence, f.root, f.commit);

test("the entire frozen draft and source identity map validate", () => {
  validateInventory(inventory, implementation, root); validateSources(inventory, sources);
  assert.equal(inventory.requirements.length, 64); assert.equal(inventory.packages.length, 24);
  assert.equal(inventory.acceptance_scenarios.length, 30); assert.equal(sources.files.length, 100);
});
test("requirement removal or duplicate mapping cannot reduce scope", () => {
  const map = clone(implementation); map.requirements.pop();
  assert.throws(() => validateInventory(inventory, map, root), /identifiers/);
  map.requirements.push(map.requirements[0]); assert.throws(() => validateInventory(inventory, map, root), /identifiers/);
});
test("equal-count provider edits, format removal and contract changes cannot alter the frozen draft", () => {
  for (const mutate of [x => x.variant_checklists.providers[0].baseline_identifier = "substitute",
    x => x.variant_checklists.formats[0].formats.pop(), x => x.requirements[0].target_contract += " changed"]) {
    const x = clone(inventory); mutate(x); assert.throws(() => validateInventory(x, implementation, root), /Frozen/);
  }
});
test("source commit substitutions and malformed receipts fail", () => {
  const refs = clone(sources); refs.files[0].commit = "b".repeat(40);
  assert.throws(() => validateSources(inventory, refs));
  refs.files[0] = { ...sources.files[0], bytes: 0 }; assert.throws(() => validateSources(inventory, refs));
});
test("partial and implemented claims need mappings, remaining scope and an owner", () => {
  const map = clone(implementation), row = map.requirements[1]; row.status = "partial";
  assert.throws(() => validateInventory(inventory, map, root), /unsupported/);
  row.implementation_paths = ["package.json"]; row.test_paths = ["scripts/parity/inventory.node.mjs"];
  assert.throws(() => validateInventory(inventory, map, root), /remaining/);
  row.status = "implemented"; assert.throws(() => validateInventory(inventory, map, root), /verification owner/);
});
test("file paths reject traversal, absolute paths and symlinks", t => {
  const dir = mkdtempSync(join(tmpdir(), "mso-parity-path-")); t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "regular"), "safe"); symlinkSync(join(dir, "regular"), join(dir, "alias"));
  for (const name of ["../regular", "/etc/passwd", "alias", "./regular"]) assert.throws(() => safeFile(dir, name));
  assert.equal(safeFile(dir, "regular"), join(dir, "regular"));
});
test("candidate source evidence excludes ignored files and requires exact clean HEAD", t => {
  const dir = mkdtempSync(join(tmpdir(), "mso-parity-git-")); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = args => execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git(["init", "-q"]); writeFileSync(join(dir, ".gitignore"), "ignored.txt\n"); writeFileSync(join(dir, "tracked.txt"), "source");
  writeFileSync(join(dir, "ignored.txt"), "not source"); git(["add", "."]);
  git(["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "synthetic candidate"]);
  const map = { requirements: [{ id: "NK-001", source_paths: ["tracked.txt"], implementation_paths: [], test_paths: [] }] };
  assert.equal(candidateHead(dir), git(["rev-parse", "HEAD"])); validateCandidateMappings(map, dir);
  map.requirements[0].source_paths = ["ignored.txt"]; assert.throws(() => validateCandidateMappings(map, dir), /tracked regular blob/);
  assert.throws(() => candidateHead(dir, "b".repeat(40)), /not HEAD/);
  for (const flag of ["skip-worktree", "assume-unchanged"]) {
    git(["update-index", `--${flag}`, "tracked.txt"]); writeFileSync(join(dir, "tracked.txt"), "hidden runtime change");
    assert.equal(git(["status", "--porcelain", "--untracked-files=all"]), "");
    assert.throws(() => candidateHead(dir), /index hides tracked changes/);
    writeFileSync(join(dir, "tracked.txt"), "source"); git(["update-index", `--no-${flag}`, "tracked.txt"]);
  }
  writeFileSync(join(dir, "untracked.txt"), "edit"); assert.throws(() => candidateHead(dir), /not clean/);
});
test("absent full-parity evidence is blocked", () => {
  assert.match(validateEvidence(inventory, implementation, null, root, "a".repeat(40))[0], /absent/);
});
test("synthetic evidence exercises the complete structure only, including every adapter dimension", t => {
  const f = fixture(t); assert.deepEqual(check(f), []);
  assert.equal(requiredVariants(inventory).length, 69);
  f.evidence.candidate_commit = "b".repeat(40); assert.ok(check(f).some(error => /clean candidate/.test(error)));
});
test("pending or partial implementation remains blocked despite a complete manifest shape", t => {
  const f = fixture(t); f.implementation.requirements[0].status = "partial";
  assert.ok(check(f).some(error => /NK-001: implementation remains/.test(error)));
});
test("fixture-only adapters, missing dimensions and failed gates do not pass", t => {
  const f = fixture(t); f.evidence.compatibility[0].mode = "fixture"; f.evidence.requirements[0].dimensions.pop();
  f.evidence.gates[0].status = "fail"; const errors = check(f).join("\n");
  assert.match(errors, /provider:openai/); assert.match(errors, /completion dimensions/); assert.match(errors, /typecheck/);
});
test("unknown or duplicate acceptance mappings cannot pass", t => {
  const f = fixture(t); f.evidence.requirements[0].acceptance = ["A999", "A999"];
  assert.ok(check(f).some(error => /NK-001 acceptance/.test(error)));
});
test("artifact integrity, size and file boundary are checked from actual bytes", t => {
  const f = fixture(t); writeFileSync(join(f.root, "receipt.txt"), "changed");
  assert.ok(check(f).some(error => /Artifact bytes changed/.test(error)));
  f.evidence.artifacts[0].path = "../escape.txt"; assert.ok(check(f).some(error => /Invalid relative/.test(error)));
});
