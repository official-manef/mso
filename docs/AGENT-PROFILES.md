# Saved agent profiles

Saved profiles are a supported intermediate slice of Nakama parity PK08 / NK009–NK010.
They persist an Owner device's configuration and execute foreground read tasks with
server-enforced tool selection. The remaining organization, assignment and isolated
worker requirements are not complete.

## Use

Open **Alfa → Agents → Saved profiles** (`/assistant/agents`). Create a profile with a
name, optional initials, instructions, exact provider/model IDs, and selected read
tools. The selected Settings connection pre-fills the model fields. Saving does not
test that connection; a missing connection stops execution with a visible error.

Save a reason with each configuration edit. The detail panel shows every revision's
actor, time, reason and configuration. Clone creates a new same-device profile from
the selected snapshot. Set default selects the profile used when the run API omits
`profileId`; callers must still send its exact `profileRevision`. The first profile
becomes default. Disabling the default clears that selection; enabling it does not
silently restore the default.

**Run a read task** starts a new native MSO Agent session with the selected saved
revision. Tasks have no earlier browser chat, owner memory, implicit project context
or inherited knowledge snapshot. Native Sessions contain the run and tool receipts.
The result arrives when the foreground task finishes. Stop cancels the request;
completed reads remain recorded. This surface does not stream text or resume tasks.

Browser personas remain under the separate **Browser personas** tab. Their
`alfa.agents` localStorage, active `@mention` and legacy main-chat behavior remain
independent of saved profiles. Browser backup does not back up server profiles.

## Authority and execution

The server derives `web:<device_id>` from a live authenticated Owner session. The
profile API accepts no owner, principal, grant or capability policy from the client.
Each device has a separate profile namespace. This is the existing trusted-owner
deployment model, **not human account, organization or process isolation**. Other
Owner devices retain the deployment's existing owner capabilities and Sessions
monitor. CLI and browser devices therefore normally have different profile lists.

Only runtime `mso-readonly` is supported. The reviewed read allowlist is:

| Tools | Existing authority |
|---|---|
| `fs_list`, `fs_read`, `fs_search`, `fs_usage` | Host read roots, credential denylist and bounded filesystem adapters |
| `projects_list`, `project_get`, `project_candidate_search`, `project_capabilities` | Existing project discovery and read guards |
| `vps_status` | Existing bounded host status adapter |

The saved allowlist only narrows these reads. It does not introduce a per-profile
filesystem jail: allowed paths still come from the deployment's existing roots.
Empty tool selection permits text-only model responses. Unknown tools, mutation or
exec tools, external runtimes, organization moves and assignment fields fail with
an unsupported error. Skills, connected MCPs, knowledge, memory, ACP/CLI runtimes,
delegation, background scheduling, deletion and cross-organization transfer are not
implemented by this profile lifecycle.

`lib/agent/bounded-runner.ts` supplies the same provider-neutral loop as same-session
subagents. It rechecks live authority before and after model/tool steps. The profile
adapter re-reads the saved enabled state and exact revision at each boundary, then
invokes the canonical capability kernel with server-fixed principal, read scope and
allowed tools. Client/model arguments cannot override those values. Editing,
disabling, removing the stored profile, or revoking the Owner session stops further
steps; an already-started read may finish before the next boundary check.

Each run uses the exact saved provider and model reference without changing the
deployment default. Connection credentials remain in the existing owner config or
OAuth store and never become profile fields. Connection changes are observed at
preparation of the next run; model preparation may perform the existing OAuth token
refresh. A run uses its prepared connection for its lifetime. No durable delegation
grant is minted. Public MCP and legacy Alfa tool catalogs are unchanged.

## Storage and concurrency

The default directory is `~/.mso/agent-profiles`; `OS_AGENT_PROFILES_DIR` overrides it.
Per-device files use a SHA-256 principal filename, schema version 1, private file
permissions, checked owner paths, a cross-process lock, fsync and atomic replacement.
The configured directory is also blocked from generic filesystem tools and recursive
archives, including when `OS_FS_ALLOW_SENSITIVE=1`.

Every mutation supplies the current store `expectedRevision`. Existing-profile
mutations also require `profileRevision`. A conflict returns HTTP 409 without
overwriting another edit. Create, edit, default, enable and disable record a revision;
clone records a new profile's first revision with its source ID/revision. The API
rechecks Owner authorization after lock acquisition and immediately before commit.
Revision snapshots are append-only through this API, not a tamper-proof audit ledger
against host administrators.

Missing stores start empty. Corrupt JSON, invalid schemas, unsafe permissions or
symlinked policy paths fail closed and are not overwritten. If directory fsync fails
after replacement, the API reports an uncertain commit; refresh before retrying.
Use deployment-level private backups for this directory. There is no profile
export/import or migration API in this slice.

Limits: 100 profiles per device, 200 revisions per profile, 4 MiB per store, 16 KiB
request bodies, 4,000-character instructions and 8,000-character task text. Runs
allow six model turns, sixteen tool calls and sixty seconds. The HTTP process allows
one foreground task per device and ten starts per minute. The task admission limit
is process-local, not a distributed worker scheduler.

## API and CLI

`GET /api/v1/agent-profiles` returns the authenticated device's store, selected model
reference, and supported read-tool descriptions. `POST` accepts `action`,
`expectedRevision`, `reason`, and fields required for that action. Create/edit use
`config`; clone uses source `id`, `profileRevision` and the new `name`. Default,
enable and disable use `id` and `profileRevision`.

```json
{
  "action": "create",
  "expectedRevision": 0,
  "reason": "Inspect repository files",
  "config": {
    "name": "Repository reader",
    "avatar": "RR",
    "instructions": "Cite the files you inspect.",
    "runtime": "mso-readonly",
    "model": { "provider": "openai", "model": "configured-model-id" },
    "tools": ["fs_read", "fs_list"]
  }
}
```

`POST /api/v1/agent-profiles/run` accepts only `profileId`, `profileRevision` and
`prompt`. It returns `runId` (native session ID), the actual profile/model binding,
status, final text, rounds and tool outcomes. Both APIs require Owner and return
private no-store responses. Run failures return a sanitized error code.

```bash
mso agent-profiles list
mso agent-profiles create @profile.json
mso agent-profiles edit @revision.json
mso agent-profiles clone @clone.json
mso agent-profiles default @selection.json
mso agent-profiles disable @selection.json
mso agent-profiles enable @selection.json
mso agent-profiles run @task.json
```

The CLI uses the same HTTP authority and revision checks. No new public MCP tools or
Workflow Graph profile execution nodes are claimed in this slice.

## Verification boundary

Store, route and runtime tests cover actual private-file persistence, stale/concurrent
edits, clone/default history, cross-device requests, unsupported policy, unsafe store
paths, cancellation and permission changes during a task. Provider responses are
explicit local test doubles. The browser fixture exercises real lifecycle APIs,
reload, reflow and a real missing-connection error; it does not claim live-provider
verification. The UI follows existing AppShell typography, theme tokens, form
controls and list/detail layout, with one-column reflow and visible task/error states.
