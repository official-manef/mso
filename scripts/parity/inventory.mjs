import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { safeFile, sameIds } from "./paths.mjs";

export const SNAPSHOT_SHA256 = "affef4135ff5cc7afc115d49966f4160bc10c5ca756a977f223f7d56e0f1bbef";
export const PATH_FIELDS = ["source_paths", "implementation_paths", "test_paths"];
export function readInventory(root) {
  const read = name => JSON.parse(readFileSync(join(root, "docs/parity", name), "utf8"));
  return { inventory: read("nakama-v0.1.json"), implementation: read("nakama-implementation.json"), sources: read("source-references.json") };
}
export function validateInventory(inventory, implementation, root) {
  const digest = createHash("sha256").update(JSON.stringify(inventory)).digest("hex");
  if (digest !== SNAPSHOT_SHA256) throw new Error("Frozen v0.1 snapshot changed; record progress separately");
  if (implementation?.schema_version !== "mso.nakama-parity-implementation.v1" || implementation.baseline !== "nakama-v0.1.json")
    throw new Error("Unknown implementation map schema");
  sameIds(implementation.requirements?.map(row => row.id), inventory.requirements.map(row => row.id), "requirements");
  for (const row of implementation.requirements) {
    if (!["pending", "partial", "implemented"].includes(row.status)) throw new Error(`${row.id}: invalid status`);
    for (const field of PATH_FIELDS) {
      if (!Array.isArray(row[field]) || new Set(row[field]).size !== row[field].length) throw new Error(`${row.id}: invalid ${field}`);
      for (const name of row[field]) safeFile(root, name);
    }
    if (!Array.isArray(row.remaining) || row.remaining.some(text => typeof text !== "string" || !text.trim())) throw new Error(`${row.id}: invalid remaining scope`);
    if (row.status !== "pending" && (!row.implementation_paths.length || !row.test_paths.length)) throw new Error(`${row.id}: unsupported completion mapping`);
    if (row.status === "partial" && !row.remaining.length) throw new Error(`${row.id}: partial scope must name remaining work`);
    if (row.status === "implemented" && (row.remaining.length || typeof row.verification_owner !== "string" || !row.verification_owner.trim()))
      throw new Error(`${row.id}: implemented status requires a verification owner and no remaining scope`);
  }
}
export function statusCounts(implementation) {
  return Object.fromEntries(["pending", "partial", "implemented"].map(status => [status, implementation.requirements.filter(row => row.status === status).length]));
}
