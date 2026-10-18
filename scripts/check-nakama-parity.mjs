#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readInventory, statusCounts, validateInventory } from "./parity/inventory.mjs";
import { validateSources } from "./parity/sources.mjs";
import { candidateHead, validateCandidateMappings } from "./parity/candidate.mjs";
import { validateEvidence } from "./parity/evidence.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
try {
  const args = process.argv.slice(2), release = args.includes("--release");
  let evidencePath, requested;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--release") continue;
    if (!["--evidence", "--commit"].includes(args[i]) || !args[i + 1]) throw new Error("Usage: --release [--evidence manifest.json] [--commit SHA]");
    if (args[i] === "--evidence") evidencePath = resolve(args[++i]); else requested = args[++i];
  }
  const { inventory, implementation, sources } = readInventory(root);
  validateInventory(inventory, implementation, root); validateSources(inventory, sources);
  console.log(`Nakama parity inventory: 64 requirements, 24 packages, 30 acceptance scenarios; ${JSON.stringify(statusCounts(implementation))}`);
  if (release) {
    const commit = candidateHead(root, requested); validateCandidateMappings(implementation, root, commit);
    const evidence = evidencePath ? JSON.parse(readFileSync(evidencePath, "utf8")) : null;
    const blockers = validateEvidence(inventory, implementation, evidence, evidencePath ? dirname(evidencePath) : root, commit);
    if (blockers.length) { console.error("BLOCKED: " + blockers.join("\nBLOCKED: ")); process.exitCode = 2; }
    else console.log("Candidate evidence structure and hashes passed; reviewers must inspect the actual runtime receipts.");
  } else console.log("Inventory validation checks traceability. Runtime parity requires separate candidate evidence.");
} catch (error) { console.error(error.message); process.exitCode = 1; }
