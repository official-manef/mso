import { sameIds } from "./paths.mjs";
const identity = row => [row.repository, row.commit, row.path].join("@");
export function validateSources(inventory, sources) {
  if (sources?.schema_version !== "mso.nakama-parity-sources.v1") throw new Error("Unknown source identity schema");
  const expected = [...new Set(inventory.all_source_hyperlinks.filter(row => row.path).map(identity))];
  sameIds(sources.files?.map(identity), expected, "source identities");
  if (expected.length !== 100) throw new Error("Pinned source identity count changed");
  for (const row of sources.files) {
    if (!/^[a-f0-9]{64}$/.test(row.sha256) || !Number.isSafeInteger(row.bytes) || row.bytes < 1
      || !Number.isSafeInteger(row.lines) || row.lines < 1) throw new Error(`Invalid source receipt: ${row.path}`);
  }
}
