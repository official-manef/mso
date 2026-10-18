# Workflow schedules

Schedule nodes use the existing Workflow Graph engine, private graph/run store,
device authority and capability pipeline. An active graph enables its triggers;
draft, archived and disabled triggers do not run. Unattended execution requires a
live approved web device with sufficient authority. A stored graph grants no privilege.

## Modes and time

| Mode | Required configuration | Occurrence |
|---|---|---|
| `interval` | `everyMinutes`: integer 1–10080; legacy omission defaults to 60 | Matching absolute UTC minute, aligned to the Unix epoch |
| `cron` | Five numeric fields: minute, hour, day of month, month, weekday | Matching local minute in the configured IANA timezone |
| `runAt` | Explicit-offset `runAt` plus `missedPolicy: "run_once"` | One normalized absolute instant |

The shared scheduler checks active graph definitions every 15 seconds and starts
at most 50 new runs per tick. It is a polling scheduler; the timestamp is the earliest
eligible time, not a promise to start at that exact millisecond.

For example, `2026-11-01T09:00:00+07:00` and `2026-11-01T02:00:00Z` identify the
same instant. The editor and saved configuration preserve the entered offset.
Identity and the UTC preview normalize it to `2026-11-01T02:00:00.000Z`.
Timezone changes do not move an explicit-offset `runAt` instant.

Before that instant a one-shot trigger is ineligible. At or after it, the first
available active tick runs it once. The same policy applies after downtime, delayed
polling or late activation. `run_once` must be selected explicitly in configuration;
there is no implicit skip, grace window, expiry or recurring reinterpretation.

## Identity, persistence and recovery

The occurrence identity combines graph id, trigger node id and normalized instant.
Equivalent offset spellings, graph revisions, timezone changes, repeated ticks and
module reloads retain that identity. Moving the instant or creating another graph
or trigger identifies a new occurrence.

One-shot claims live beside detailed receipts in the existing private workflow run
directory. The existing run lock commits an `intent_committed` claim before workflow
dispatch. Engine completion records `run_finished` with the observed run state.
Before dispatch, the writer syncs ancestor directory entries, the temporary claim
file, and the pinned parent directory after rename. Any sync failure blocks dispatch;
a failure after rename retains an uncertain intent for reconciliation, without retry.

Claims contain identity, scheduled time and minimal engine-state metadata. They retain
no prompt, action input, output or credential. They have no automatic expiry and are
retained when detailed receipts are deleted or pruned by the 1000-receipt retention
limit. Removing or expiring a claim would permit duplicate execution of its occurrence.

If a claim exists but its receipt is unavailable, automatic ticks and the same
idempotency identity refuse replay. An intent can precede dispatch or an interrupted
effect; it does not prove the external action completed. Inspect the actual target
and reconcile before choosing an explicit new run. This slice adds no automatic
external-effect reconciliation, distributed fencing or tenant isolation.

The writer uses the existing Linux/WSL pinned descriptor authority. Unsupported or
failed filesystem sync operations fail closed; they do not fall back to rename-only
dispatch. Syscall-order and injected-fault tests verify this protocol, not a physical
power-cut experiment or guarantees about storage hardware that ignores sync.

## Cron compatibility

Cron supports five numeric fields, comma lists, inclusive ranges and positive steps.
Weekday is 0–6 with Sunday 0. Names, aliases and extra fields are rejected.
All fields are validated before matching; an earlier nonmatching field cannot hide
a malformed later field. The timezone override inherits the graph timezone when
empty; the graph default is UTC. Invalid IANA timezones are rejected on save.

Existing cron configurations without `dayMatch` retain the original AND behavior
between restricted day-of-month and weekday fields. The editor creates new cron
configurations with explicit `dayMatch: "or"`: either restricted day field may match.
The editor also offers explicit `and` for compatibility. With a wildcard day field,
the other field still constrains the date. A repeated local clock minute during a
daylight-saving transition has two distinct absolute-minute identities; a skipped
local minute has no occurrence. Cron does not backfill missed minutes after downtime.

The editor clears fields belonging to the previous mode when switching modes.
Older editors retained `everyMinutes` on cron records and `cron` on interval
records. Those inactive recurring fields remain stored and inert, so existing
graphs stay readable and run only their selected mode. Saving and execution
validate the active mode's numbers, cron expression and timezone. Unknown modes,
invalid dates, unsupported policies and mixtures of one-shot and recurring fields
are rejected; an inactive field never supplies a fallback schedule.

## Verification scope

The regression suite covers before/due/late evaluation, stable offset identity,
concurrent ticks and direct run guards, module reload, receipt deletion and pruning,
authority revocation, malformed saves, cron compatibility and timezone transitions.
Durability tests observe ancestor/file/directory sync order and verify that failures
prevent dispatch, clean up descriptors and retain uncertain claims without replay.
The browser journey exercises real editor changes, rejected saves, offset preview,
save/reload and an output-only due run through the server timer. Its result belongs
to the release candidate where the browser test was actually executed.
