# Nakama parity evidence

The frozen [v0.1 snapshot](./nakama-v0.1.json) preserves every requirement, clause,
package, stage, acceptance journey, provider, format, transport and platform from
the approved draft. Its complete parsed JSON has a fixed SHA-256 in the validator.
Record progress in [the implementation map](./nakama-implementation.json).
Changing identifiers while retaining counts, or removing a format or contract,
does not preserve this snapshot.

The [source receipts](./source-references.json) identify 100 distinct files at
the two pinned commits. A source hash proves which bytes were read. It does not
prove that a feature works or that a current provider account supports it.

## Development checks

Run `bun run parity:nakama` and `bun run test:parity`. They are also part of
`bun run check`. Regenerate the current reference with
`node scripts/gen-nakama-parity.mjs` after changing the implementation map.

Each requirement is pending, partial, or implemented. Partial rows need code,
tests, and explicit remaining scope. Implemented rows also need a verification
owner and no remaining scope. Neither status alone establishes runtime parity.

## Full parity candidate gate

From the exact clean candidate checkout, run:

```sh
bun run parity:nakama:release --evidence /absolute/path/to/manifest.json --commit EXACT_HEAD_SHA
```

The gate rejects a different HEAD, modified tracked files, untracked files,
index entries marked `skip-worktree` or `assume-unchanged`, and
source/test mappings that are not regular blobs in that candidate's Git tree.
Ignored dependencies, build outputs, symlinks and submodules cannot stand in for
committed implementation evidence. All 64 requirements must be implemented.

The manifest has schema `mso.nakama-parity-evidence.v1`, `candidate_commit`,
`working_tree_clean: true`, a valid `created_at` timestamp, and an environment
with `kind: "runtime"` and nonempty strings for `name`, `platform`, and `node`.
It contains these arrays:

| Array | Required records |
|---|---|
| `gates` | typecheck, lint, tests, build, security, regression |
| `requirements` | Every NK ID, its exact acceptance references, and all eight DOD dimensions |
| `acceptance` | Every A01–A30 journey |
| `compatibility` | Every ID and test dimension from `requiredVariants()` in the variant module |
| `artifacts` | Identified, nonempty evidence files with byte count and SHA-256 |

Each result record has `id`, `status: "pass"`, `candidate_commit`, and a nonempty
array of artifact IDs. Requirements, acceptance journeys, compatibility records
and their dimensions also require `mode: "runtime"`. Requirements include
`acceptance` as the exact set in the snapshot and `dimensions` as an array of
DOD result records. Compatibility records have a `dimensions` array containing
the exact adapter test dimensions. Empty expected dimension sets still use an
empty array. Additional or duplicate IDs do not count as coverage.

An artifact has `id`, `path`, `bytes`, and `sha256`. Its path is relative to
the manifest directory, contains no traversal or symlink, and names a regular
file of 1 byte through 20 MiB. Artifact verification currently requires Linux or
WSL with `/proc/self/fd`; unsupported platforms or unavailable descriptor pinning
block the gate. Every directory is opened from a pinned parent with `O_NOFOLLOW`.
The final file is opened once, checked through that descriptor, and read through
the same descriptor into a bounded buffer. A one-byte sentinel detects growth;
size or modification metadata changes during the read block the artifact.
Pathname replacement cannot redirect the read to another file. This is a checked
byte snapshot, not a filesystem-wide transaction or a physical storage guarantee.
Keep credentials and private tenant data out of public receipts; include only the
bounded evidence needed to assess the result.

The variant list derives providers, transports, harnesses, channels, formats,
the knowledge ZIP container, platforms, and all baseline shell/network
combinations. Merely supporting a model tool does not imply media, MCP resources,
or prompts support. Additional platforms marked as optional extensions in the
snapshot do not become a baseline installer claim.

## What a passing manifest means

This validator checks completeness, candidate identity, file boundaries and
integrity. It cannot establish whether a receipt's statements are true. Reviewers
must inspect actual requests, responses, provider identities, delivery IDs,
authorization denials and recovery outcomes before making a release claim.

Synthetic tests deliberately exercise the validator's success shape. They are
not release manifests. Labeling fixture results as runtime results would still
be false, even if someone could produce a structurally valid manifest. The full
parity gate remains blocked while requirements or real acceptance work remain.
