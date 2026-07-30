---
name: health-scan
description: Optional weekly read-only repository health digest. NOT an orchestrator — never creates issues, comments, branches, or PRs.
---
# Health scan (optional fallback, read-only)

Scope: a <=15-line digest in the job summary. Inputs via `gh` (read-only):
stale agent tasks (agent:* labels, no activity 7+ days), open agent PRs and
their check status, CI pass rate on the default branch over the last week,
tasks stuck at agent:human-required.

Prohibited: creating or editing issues/comments/PRs/branches, editing
docs/STATE.md, dispatching events. The event-driven loop (docs/AGENT_LOOP_SPEC.md)
is the only orchestrator; this scan only surfaces what a human might have missed.
