#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readInventory, statusCounts } from "./parity/inventory.mjs";
import { requiredVariants } from "./parity/variants.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { inventory: x, implementation } = readInventory(root), counts = statusCounts(implementation);
const rows = new Map(implementation.requirements.map(row => [row.id, row]));
const cell = text => String(text).replaceAll("|", "\\|").replaceAll("\n", " ");
const lines = ["# Paritas Nakama ke MSO", "",
  "Dokumen ini dihasilkan dari snapshot draf v0.1 yang dibekukan dan peta implementasi terpisah. Status mengacu pada kebutuhan penuh, bukan jumlah layar yang sudah dibuat.", "",
  `Target tetap **64 kebutuhan, 24 paket, 8 tahap, dan 30 skenario penerimaan**. Status saat ini: **${counts.pending} pending, ${counts.partial} partial, ${counts.implemented} implemented**.`, "",
  `Sumber dibekukan pada [Nakama ${x.baselines.nakama.commit.slice(0,12)}](https://github.com/${x.baselines.nakama.repository}/tree/${x.baselines.nakama.commit}) dan [MSO ${x.baselines.mso.commit.slice(0,12)}](https://github.com/${x.baselines.mso.repository}/tree/${x.baselines.mso.commit}). Identitas 100 berkas sumber tercatat; identitas berkas tidak membuktikan perilaku runtime.`, "",
  "Kontrak lengkap tersimpan dalam [snapshot](./parity/nakama-v0.1.json), [peta implementasi](./parity/nakama-implementation.json), [identitas sumber](./parity/source-references.json), dan [aturan bukti](./parity/EVIDENCE.md).", "",
  "## Kebutuhan dan kontrak", "", "| ID | Kebutuhan | Status | Paket | Penerimaan | Kontrak penuh |", "|---|---|---|---|---|---|"];
for (const r of x.requirements) lines.push(`| ${r.id} | ${cell(r.title)} | ${rows.get(r.id).status} | ${r.packages.join(", ")} | ${r.acceptance.join(", ")} | ${cell(r.target_contract)} |`);
lines.push("", "## Bagian yang telah diterapkan", "");
for (const r of implementation.requirements.filter(row => row.status !== "pending")) {
  lines.push(`### ${r.id}`, "", `Kode: ${r.implementation_paths.map(p => `[${p}](../${p})`).join(", ")}.`, "",
    `Pengujian: ${r.test_paths.map(p => `[${p}](../${p})`).join(", ")}.`, "", ...r.remaining.map(text => "- " + text), "");
}
lines.push("## Paket kerja", "", "| Paket | Tahap | Hasil |", "|---|---|---|");
for (const r of x.packages) lines.push(`| ${r.id} | ${r.stage} | ${cell(r.description)} |`);
lines.push("", "## Tahap", "", "| Tahap | Hasil | Syarat keluar |", "|---|---|---|");
for (const r of x.stages) lines.push(`| ${r.id} | ${cell(r.outcome)} | ${cell(r.exit_criteria)} |`);
lines.push("", "## Penerimaan", "", "| ID | Skenario | Hasil yang harus dibuktikan |", "|---|---|---|");
for (const r of x.acceptance_scenarios) lines.push(`| ${r.id} | ${cell(r.title)} | ${cell(r.expected_outcome)} |`);
lines.push("", "## Variasi dan gate", "",
  `Checklist kandidat menguraikan ${requiredVariants(x).length} varian wajib dari draf, termasuk 31 provider, transport, kombinasi shell/network, format/kontainer, dan platform. Tambahan platform yang ditandai ekstensi tetap terpisah dalam snapshot.`, "",
  "`bun run parity:nakama` memeriksa inventaris; `bun run parity:nakama:release --evidence /path/manifest.json` memeriksa bukti kandidat. Kelulusan inventaris bukan kelulusan runtime. Bukti sintetis tidak dapat memenuhi klaim kompatibilitas runtime.", "",
  "Hak Viewer/Operator/Owner yang ada adalah peran perangkat. Peta ini tidak mengubahnya menjadi akun manusia atau memberikan isolasi organisasi secara otomatis.", "");
const content = lines.join("\n"), target = resolve(root, "docs/NAKAMA-PARITY.md");
if (process.argv.includes("--check")) {
  if (readFileSync(target, "utf8") !== content) { console.error("Nakama parity documentation is stale"); process.exitCode = 1; }
  else console.log("Nakama parity documentation is current");
} else { writeFileSync(target, content); console.log("Generated docs/NAKAMA-PARITY.md"); }
