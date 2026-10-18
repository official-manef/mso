# Changelog

**Generated — do not edit.** `node scripts/gen-changelog.mjs`, run by `bun run ship`.
Newest first. `docs/PROGRESS.md` is the source of truth for *why* a change was made;
this is the *what*, and it is what Settings → Account → About shows as “What's new”.

## 2026-10-18

**Added**

- `mcp` bump toolset version and regenerate MCP catalog for fs_stat
- `mcp` add fs_stat read capability and parity exemption
- `mcp` reclaim ChatGPT profile budget by lowering compact description cap
- `host` add statReadableMeta for bounded path metadata
- `cli` named `threads rename` verb for PATCH /api/threads
- `assistant` render per-turn token usage and running thread total
- `ai` parse and propagate provider usage from stream turn
- `workflow` bind graph agent node to durable sessions via sessionRef
- `agent` add durable session turn runner with lease and persistence
- `assistant` add search, rename, recency, and confirm-gated delete to thread drawer
- `assistant` add title override support to useThreadPersistence
- `skills` wire catalog TTL cache into /api/skills list route
- `skills` implement createCatalogTtl memo with injected clock
- `api` add PATCH endpoint to rename threads
- `ai` add renameThread helper with atomic save

**Fixed**

- `assistant` reset thread drawer state during render, not in effect
- `update` treat a proven service-owned listener as update-safe
- `assistant` keep the eager shell CSS rule set unchanged

**Changed**

- `assistant` move chat turn-usage state into use-turn-usage hook

**Tests**

- `mcp` add unit tests for fs_stat read capability
- `api` cover GET and POST handlers in threads route test

**Docs**

- record the service-owned update fix and the lint restoration
- `progress` record the fs_stat revival and the tighter compact cap
- `progress` record the fs_stat revert and the threads rename CLI verb
- `progress` record the 2026-10-18 agent-surface batch and the no-change bench
- `workflows` document proactive turns on durable sessions in workflow graphs

**Other**

- Revert "feat(mcp): add fs_stat read capability for bounded path metadata"

## 2026-10-17

**Added**

- `models` discover model ids from custom endpoints

**Docs**

- `progress` record custom-endpoint discovery deploy and no-service ship limitation

## 2026-10-15

**Other**

- Merge pull request #121 from rahmanef63/dependabot/bun/development-minor-patch-fd1384ab1e
