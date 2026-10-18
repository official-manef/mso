export function requiredVariants(inventory) {
  const v = inventory.variant_checklists, result = [];
  const add = (id, row) => result.push({ id, dimensions: row.test_dimensions ?? [] });
  for (const row of v.providers) add(`provider:${row.baseline_identifier}`, row);
  for (const id of v.mcp.baseline_transports) add(`mcp:${id}`, v.mcp);
  for (const row of v.acp) add(`acp:${row.preset}`, row);
  for (const row of v.coding_harnesses) add(`harness:${row.harness}`, row);
  for (const backend of v.shell.baseline_backends) for (const network of v.shell.baseline_network_modes) add(`shell:${backend}:${network}`, v.shell);
  for (const row of v.channels) add(`channel:${row.channel}`, row);
  for (const row of v.formats) {
    for (const id of row.formats ?? row.languages ?? row.output_formats ?? row.inputs) add(`format:${row.area}:${id}`, row);
    if (row.import_container) add(`format:${row.area}:container:${row.import_container}`, row);
  }
  for (const row of v.platforms) add(`platform:${row.platform}`, row);
  return result;
}
