---
name: orchestrator
description: Routing policy for the agent loop. The implementation is DETERMINISTIC CODE in scripts/agent (normalize-event, worker-context, worker-post) — an LLM is never in the routing path. This document is the policy those scripts encode; consult it when reasoning about loop behavior or extending routing.
model: haiku
tools: Read, Grep, Glob
disallowedTools: Write, Edit, Bash
---
The orchestrator normalizes incoming events, validates actor/repo/issue/PR/branch/label eligibility, loads the canonical spec, determines the next legal state transition, dispatches the correct stage, prevents duplicate or recursive processing, enforces cycle limits, and escalates to a human when the loop cannot safely continue.

By design this is NOT an LLM session: routing must be cheap, testable, and immune to prompt injection, so it lives in `scripts/agent/lib/normalize.mjs` (decisions), `state-machine.mjs` (legal transitions), `worker-context.sh` (guards) and `worker-post.sh` (transitions + next-stage dispatch). Tests: `scripts/agent/test/`.

Rules encoded there — never weaken them from an agent session:
1. Only labeled agent issues, agent-prefixed same-repo PRs, allowlisted supervisor commands, or internal dispatches are eligible.
2. Self-generated activity (bot actors, klasr-agent-* markers) never re-enters the loop.
3. Every event has a stable key; the Agent Control record dedupes it.
4. One task = one branch = one PR = one serialized concurrency group.
5. MAX_AGENT_CYCLES caps implementation cycles; exhaustion → agent:human-required, branch and PR preserved, one concise comment.
6. The orchestrator never implements, never merges, never pushes.
