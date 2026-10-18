import { createHash } from "node:crypto";
import { readArtifactSnapshot, sameIds } from "./paths.mjs";
import { requiredVariants } from "./variants.mjs";

export const GATES = ["typecheck", "lint", "tests", "build", "security", "regression"];
export function validateEvidence(inventory, implementation, evidence, root, commit) {
  if (!evidence) return ["Full parity evidence is absent"];
  const errors = [], check = operation => { try { operation(); } catch (error) { errors.push(error.message); } };
  check(() => {
    if (evidence.schema_version !== "mso.nakama-parity-evidence.v1" || !/^[a-f0-9]{40}$/.test(commit)
      || evidence.candidate_commit !== commit || evidence.working_tree_clean !== true) throw new Error("Evidence must name this clean candidate");
    if (evidence.environment?.kind !== "runtime" || ["name", "platform", "node"].some(key => typeof evidence.environment[key] !== "string" || !evidence.environment[key].trim())
      || !Number.isFinite(Date.parse(evidence.created_at))) throw new Error("Runtime environment and timestamp required");
  });
  const artifacts = new Map();
  check(() => {
    if (!Array.isArray(evidence.artifacts) || !evidence.artifacts.length) throw new Error("Evidence artifacts required");
    sameIds(evidence.artifacts.map(row => row.id), [...new Set(evidence.artifacts.map(row => row.id))], "artifact ids");
    for (const row of evidence.artifacts) {
      const bytes = readArtifactSnapshot(root, row.path);
      if (row.bytes !== bytes.length || !/^[a-f0-9]{64}$/.test(row.sha256)
        || createHash("sha256").update(bytes).digest("hex") !== row.sha256) throw new Error(`Artifact bytes changed: ${row.id}`);
      artifacts.set(row.id, row);
    }
  });
  const receipt = (row, id, runtime = false) => {
    if (row?.status !== "pass" || row.candidate_commit !== commit || (runtime && row.mode !== "runtime"))
      throw new Error(`${id}: passing candidate runtime receipt required`);
    if (!Array.isArray(row.artifacts) || !row.artifacts.length || new Set(row.artifacts).size !== row.artifacts.length
      || row.artifacts.some(key => !artifacts.has(key))) throw new Error(`${id}: valid artifact references required`);
  };
  const group = (rows, ids, label, runtime) => {
    check(() => sameIds(rows?.map(row => row.id), ids, label));
    return new Map((Array.isArray(rows) ? rows : []).map(row => {
      check(() => receipt(row, row.id, runtime)); return [row.id, row];
    }));
  };
  group(evidence.gates, GATES, "gates", false);
  group(evidence.acceptance, inventory.acceptance_scenarios.map(row => row.id), "acceptance", true);
  const requirements = group(evidence.requirements, inventory.requirements.map(row => row.id), "requirements", true);
  for (const row of inventory.requirements) {
    if (implementation.requirements.find(item => item.id === row.id)?.status !== "implemented") errors.push(`${row.id}: implementation remains pending or partial`);
    const record = requirements.get(row.id);
    check(() => sameIds(record?.acceptance, row.acceptance, `${row.id} acceptance`));
    group(record?.dimensions, inventory.definition_of_done.map(item => item.id), `${row.id} completion dimensions`, true);
  }
  const variants = requiredVariants(inventory), records = group(evidence.compatibility, variants.map(row => row.id), "compatibility", true);
  for (const row of variants) group(records.get(row.id)?.dimensions, row.dimensions, `${row.id} adapter dimensions`, true);
  return errors;
}
