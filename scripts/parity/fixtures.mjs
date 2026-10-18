import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { GATES } from "./evidence.mjs";
import { requiredVariants } from "./variants.mjs";
export function evidenceFixture(inventory, implementation) {
  const root = mkdtempSync(join(tmpdir(), "mso-parity-evidence-")), commit = "a".repeat(40);
  const bytes = Buffer.from("SYNTHETIC validator fixture. This is not release evidence.\n");
  writeFileSync(join(root, "receipt.txt"), bytes, { mode: 0o600 });
  const receipt = id => ({ id, status: "pass", mode: "runtime", candidate_commit: commit, artifacts: ["receipt"] });
  const map = structuredClone(implementation);
  for (const row of map.requirements) { row.status = "implemented"; row.remaining = []; row.verification_owner = "Synthetic fixture"; }
  return { root, commit, implementation: map, evidence: {
    schema_version: "mso.nakama-parity-evidence.v1", candidate_commit: commit, working_tree_clean: true,
    environment: { kind: "runtime", name: "synthetic schema fixture", platform: "test", node: "test" }, created_at: "2026-10-18T00:00:00Z",
    artifacts: [{ id: "receipt", path: "receipt.txt", bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }],
    gates: GATES.map(receipt), acceptance: inventory.acceptance_scenarios.map(row => receipt(row.id)),
    requirements: inventory.requirements.map(row => ({ ...receipt(row.id), acceptance: row.acceptance, dimensions: inventory.definition_of_done.map(row => receipt(row.id)) })),
    compatibility: requiredVariants(inventory).map(row => ({ ...receipt(row.id), dimensions: row.dimensions.map(receipt) })),
  } };
}
