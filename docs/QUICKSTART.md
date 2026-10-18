# First 10 minutes with MSO

> This is the canonical **tutorial**: one path to first value. It deliberately does not explain every feature. For production hosting, use a supported Linux host and keep the raw app loopback-bound behind your chosen protected HTTPS/private-network path.

## Goal

Reach one verified, read-first agent action against a real project, then see the evidence you can resume later.

## 1. Install and diagnose

```bash
curl -fsSL https://raw.githubusercontent.com/rahmanef63/mso/main/scripts/install.sh | bash
mso doctor
```

Do not continue past an unexpected doctor failure. Fix the named layer first.

## 2. Open MSO

```bash
mso web
```

Approve the device through the supported local/Owner flow if this browser is new. Treat Owner access like SSH-equivalent authority for the MSO service user.

The **Set up MSO** guide opens for a newly signed-in browser. An existing browser that already
closed onboarding keeps that choice. Reopen it at **Settings → Account → About → Maintenance → Setup**.
The guide retains its step, selected project and run reference in this browser; skipping it does
not reset the host or require a new account or team. Viewer/Operator devices see access readiness
without the Owner-only model and project-check controls.

If restoring existing data, choose **Open backup options** before creating work. The current
Settings surface can import browser data and verify server memory snapshots into an isolated
folder. Neither operation is a full installation restore; use the supported installation and
recovery procedures for that scope.

## 3. Connect one model/provider

In the guide's **Readiness** step, review the service user, filesystem roots and access route.
**Open model connections** opens the existing private Integrations form in another tab. Configure
one provider/model, return to the guide, and refresh. The explicit **Test model request** action
uses the saved selection and may consume provider quota. Stored connection metadata alone is
not proof of inference, tool calls or multimodal support. Model setup can be skipped for the
first project check. Do not paste provider credentials into agent chat.

## 4. Pick one project

Use the Projects/Files surface or the CLI to identify a real project. Start read-only: inspect its status, current branch and recent work before asking an agent to edit anything.

The guide's **Project** step lists a bounded page from the existing host discovery service and
supports searching by project name. Empty, failed and truncated discovery are shown separately.
Selecting a returned project retains its exact id; execution resolves it again through the host
guards.

Choose **Review first action → Run project check** to save a manual workflow and read that
project's Git, package and knowledge metadata. The run uses the existing Workflow Graph engine
and `project_get`, with no project-file mutation or model call. The guide displays completion only
when the persisted receipt confirms all expected steps and the selected project. A lost response
retains the same request identity; reopening a known receipt reads it without dispatching again.
The saved workflow remains available under **Workflows**. This preflight is separate from the
agent task below.

## 5. Run the first safe agent task

From an MCP client or MSO agent, use a request shaped like:

```text
Check this project's current status and explain the highest-value next task.
Do not change files, branches, services, deployments, credentials or external systems.
```

The first success criterion is not “the model answered.” It is that MSO resolved the project, used bounded reads, and produced inspectable execution evidence without widening authority.

## 6. Make one isolated change

For source-changing work, use one task-specific hidden worktree. Never use canonical `main` as a shared agent scratchpad. Inspect the diff and run the relevant tests before integration.

## 7. Verify and resume

Confirm the session/workflow evidence exists and can be resumed. A completed response is not equivalent to a tested, integrated, released or live-verified change.

## Where next

- **How to connect an AI client:** [`MCP-HOW-TO.md`](./MCP-HOW-TO.md)
- **Install/repair/update:** [`INSTALL.md`](./INSTALL.md)
- **Concepts and architecture:** [`ARCHITECTURE.md`](./ARCHITECTURE.md)
- **Security boundaries:** [`SECURITY-ASSURANCE.md`](./SECURITY-ASSURANCE.md)
- **Memory and retention:** [`MEMORY-SAFETY.md`](./MEMORY-SAFETY.md)
- **Launch/stability gates:** [`LAUNCH-READINESS.md`](./LAUNCH-READINESS.md)
- **Exact CLI reference:** [`CLI.md`](./CLI.md)
