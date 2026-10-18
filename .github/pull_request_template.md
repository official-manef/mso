## Summary
- Change:
- Risk/rollback:

## Agent validation evidence (required)
- Exact branch / HEAD SHA:
- Targeted regression tests:
- `bun run pr:local`: PASS / FAIL / BLOCKED (evidence):
- `bun run pr:security`: PASS / FAIL / BLOCKED (evidence):
- Missing tooling or environment constraints:

## Remote readiness checklist
- [ ] All required GitHub CI and security jobs pass on the **latest HEAD**.
- [ ] No new unresolved CodeQL/code-scanning security alerts.
- [ ] All review threads resolved after actual fixes.
- [ ] Test, build, security evidence matches the reviewed commit.
- [ ] Deployment not claimed until changes reach `origin/main` and runtime verified.

**Policy:** If any preflight check is incomplete, open or leave this PR as **Draft**.
Never bypass required checks, hide parser failures, or dismiss security findings
to manufacture a green status.
