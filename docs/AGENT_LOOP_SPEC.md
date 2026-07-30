# Klasr Agent Loop v2 — implemented specification

> This document describes the system AS IMPLEMENTED in this repository — not a
> future design. Orchestration code: `scripts/agent/` (tested by `npm test`
> there). Workflows: `.github/workflows/claude-*.yml` + `_claude-run.yml`.

## 1. Audit summary (what v1 was, why it changed)

v1 was cron-centered: `claude-triage.yml` ran nightly, updated `docs/STATE.md`
and opened `chore/triage-*` PRs (see branch `chore/triage-29473909113`). Work
could start without any validated specification; no state machine, no dedupe,
no cycle cap; a bot approving its own PR was indistinguishable from review;
supervisor comments did nothing; agent pushes made with `GITHUB_TOKEN` could
not trigger follow-on workflows; agent instructions still referenced removed
infrastructure (MinIO, FastAPI, BullMQ). All of that is replaced below; the
nightly job is deleted and only an optional read-only weekly health scan
remains outside the critical path.

## 2. Implemented event flow

```
GitHub event ──▶ adapter workflow (cheap, deterministic, no Claude)
                  claude-intake.yml    issues, issue_comment
                  claude-feedback.yml  pull_request, pull_request_review,
                                       pull_request_review_comment, commit_comment
                  claude-ci-recovery.yml workflow_run(ci, completed)
                        │  node scripts/agent/normalize-event.mjs
                        │  (eligibility · allowlist · self-noise · fork rejection)
                        ▼
                repository_dispatch  agent.intake | agent.implement | agent.verify |
                (identifiers only)   agent.security_review | agent.supervisor_feedback |
                        │            agent.ci_failure
                        ▼
                claude-worker.yml  (concurrency serialized per task)
                  context job: fetch authoritative data via gh · dedupe against the
                    Agent Control record · enforce MAX_AGENT_CYCLES · route role
                  run job: _claude-run.yml (the ONLY Claude invocation point,
                    least-privilege tools per role, App token when configured)
                  post job: state transition · single control-comment upsert ·
                    label sync (one agent:<status>) · EXPLICIT next-stage dispatch
```

`repository_dispatch` and `workflow_dispatch` are the two event types GitHub
still delivers when fired with `GITHUB_TOKEN` — the loop is built on exactly
that exception, so no PAT exists anywhere in the design.

## 3. Task lifecycle

States (labels `agent:<state>`): needs-spec → spec-ready → queued → running →
reviewing → awaiting-supervisor → feedback-received → running … plus blocked,
human-required, ready, done. Legal transitions live in
`scripts/agent/lib/state-machine.mjs`; nothing infers state from natural
language. The single **Agent Control** comment on the canonical issue holds a
bounded JSON record (`<!-- klasr-agent-state … -->`, last 30 event keys) and is
PATCHed in place — never one comment per transition.

A task cannot reach implementation without a spec that passes
`scripts/agent/validate-spec.mjs`: the `agent:queued` label on an invalid spec
is ignored with an escalation reason, and the worker re-validates before every
security-relevant transition.

## 4. Event coverage

| GitHub event | Condition (deterministic) | Result |
|---|---|---|
| `issues` opened/edited/reopened | `agent-task` label, spec missing/invalid | dispatch `agent.intake` (spec-writer) |
| `issues` labeled `agent:queued` | supervisor actor + valid spec | dispatch `agent.implement` |
| `issues` labeled `agent:queued` | invalid spec | ignored + escalation reason (no run) |
| `issue_comment` created | allowlisted `/agent spec\|run\|revise\|approve\|block\|status` | dispatch intake / implement / supervisor_feedback |
| `issue_comment` created | no command, or non-supervisor, or self-marker | ignored |
| `pull_request` synchronize | human push to agent branch | dispatch `agent.verify` |
| `pull_request` synchronize | bot/self push | ignored (verify is dispatched explicitly by the worker) |
| `pull_request_review` submitted | supervisor, agent PR, same-repo | dispatch `agent.supervisor_feedback` |
| `pull_request_review_comment` created | supervisor, agent PR | dispatch `agent.supervisor_feedback` |
| commit comment (via API/dry-run payload) | supervisor + `/agent` command | normalized to `agent.supervisor_feedback` (worker resolves the PR containing the commit). GitHub removed `commit_comment` from the Actions trigger list, so no live workflow subscribes to it — supervisors use PR-conversation commands instead |
| `workflow_run` (ci) failure | head is an agent branch/PR | dispatch `agent.ci_failure` (bounded repair; no new issue while the PR is active) |
| `workflow_run` (ci) failure | head is `main`/`develop` | deterministic fingerprinted issue create-or-update — no Claude session |
| `workflow_run` (ci) success | — | no action |
| any fork PR event | — | rejected before dispatch |
| `repository_dispatch` agent.* | internal, deduped by event key | worker stage |
| `workflow_dispatch` on claude-worker | fixture name | dry run: prints decision + would-be dispatch to the job summary, writes nothing |

## 5. Roles

| Role | Trigger | Write scope | Output |
|---|---|---|---|
| orchestrator | — (deterministic code, LLM never in routing) | labels/control via worker | routing decisions (`scripts/agent`) |
| spec-writer | agent.intake | issue body spec block, one focused comment | validated spec or precise questions |
| implementer | agent.implement, agent.ci_failure | task branch + draft PR only | commits, PR body checklist, deviations |
| verifier | agent.verify (separate session) | `.agent/verdict.json` + one PR comment | machine verdict (PASS/REQUEST_CHANGES/BLOCKED) |
| security-reviewer | agent.security_review (spec-flagged or escalated) | `.agent/verdict.json` + one PR comment | blocking/non-blocking findings, confirmed invariants, unverified assumptions |
| feedback-responder | agent.supervisor_feedback | same task branch/PR, thread replies | commits + concise replies; scope changes rerouted to `/agent spec` |

A verifier PASS is an internal signal only — it never satisfies
branch-protection review requirements, and no workflow merges anything.

## 6. Security controls

- **Actor trust**: `SUPERVISOR_ACTORS` (comma-separated logins) parsed
  fail-closed — unset ⇒ repository owner only; unset AND ownerless context ⇒
  nobody. Bots are never trusted by type; external supervisor bots must be
  listed explicitly (`EXTRA_BOT_ACTORS` marks additional self identities to
  IGNORE, not to trust).
- **Commands**: `/agent <spec|run|revise|approve|block|status>` line-anchored;
  anything else in a comment is inert.
- **Recursion prevention**: bot-actor check + hidden markers
  (`klasr-agent-state`, `klasr-agent-status`, `klasr-fingerprint`) + stable
  event keys deduped against the control record + internal transitions carried
  only by explicit `repository_dispatch` + per-task serialized concurrency
  (`cancel-in-progress: false`).
- **Cycle cap**: `MAX_AGENT_CYCLES` (default 5) enforced in the worker before
  any implementation-type stage; exhaustion ⇒ `agent:human-required`, one
  comment, branch/PR preserved, no silent restart.
- **Untrusted content**: dispatch payloads carry identifiers only; the worker
  fetches authoritative bodies/diffs/checks itself and wraps every
  GitHub-authored text in `<untrusted_github_content>` delimiters inside the
  prompt, with an explicit instruction that it can never override invariants.
- **Forks**: rejected in normalization (`head.repo != base.repo`); adapter
  filter jobs check out the TRUSTED default branch only (sparse
  `scripts/agent`), never PR head code; no `pull_request_target` anywhere.
- **Permissions**: adapters `contents: write` only (needed to create
  `repository_dispatch`) — ci-recovery additionally `issues: write` +
  `actions: read`; the worker holds issue/PR write; `_claude-run` receives
  role-scoped allowed tools, checkout credentials persist only for
  implementer/feedback-responder, verifier and security-reviewer are read-only
  toward product code.
- **Protected branches**: `.claude/settings.json` guards retained
  (guard-protected-branches hook, deny force-push/--no-verify); prompts repeat
  never-push-main/develop, never merge; nothing auto-merges.
- **Tokens**: no PAT. GitHub App installation token
  (`actions/create-github-app-token`) minted per run when configured; fallback
  to `GITHUB_TOKEN` with an explicit degraded-mode notice (see §8). Secrets are
  passed only to `_claude-run`; tokens are never printed.

## 7. Autonomous issues

Only the deterministic ci-recovery path creates issues: protected-branch CI
failures are fingerprinted (`sha256(category|workflow|job|path|normalized
signature)` → 12 hex chars via `scripts/agent/lib/fingerprint.mjs`, volatile
timestamps/SHAs/line numbers/durations stripped). Before creating, open issues
are searched for the `klasr-fingerprint:<fp>` marker; a match gets a recurrence
comment instead of a duplicate. New issues carry evidence, run URL, commit,
suggested acceptance criteria and labels `bug, ci-failure, agent:needs-spec` —
they enter the loop only after a spec exists and a supervisor queues them.
Verifier out-of-scope findings land in `residual_risks` (human decides).

## 8. Required repository configuration

**Actions variables** (Settings → Secrets and variables → Actions → Variables)
- `SUPERVISOR_ACTORS` — e.g. `ColJurten`. Unset ⇒ owner-only (fail-closed).
- `MAX_AGENT_CYCLES` — optional, default `5`.
- `EXTRA_BOT_ACTORS` — optional, extra self identities to ignore (e.g. the App's `[bot]` login).

**Secrets**
- `ANTHROPIC_API_KEY` — required (already used by v1).
- `KLASR_APP_ID`, `KLASR_APP_PRIVATE_KEY` — recommended. GitHub App with
  permissions: Contents RW, Issues RW, Pull requests RW, Actions R, Checks R;
  installed on this repository. Without it the loop still runs on
  `GITHUB_TOKEN` in **degraded mode**: implementer pushes will NOT trigger the
  `ci` workflow (GitHub suppresses follow-on runs for default-token pushes), so
  PR checks stay empty until someone pushes or reruns CI manually. The
  `repository_dispatch` chain itself is unaffected (documented GitHub
  exception).

**Labels** (created on the fly by the worker with color `7F77DD`, or pre-create):
`agent-task`, `ci-failure`, and `agent:<state>` for the states in §3.

**Branch protection** (unchanged expectations): `main` and `develop` protected,
required checks `ci / api`, `ci / web`; agent branches use prefixes `feature/`
and `fix/` named `feature/<issue>-<slug>` (worker default:
`feature/<issue>-agent-task`).

**Admin hardening (do after merge)**: SHA-pin the third-party actions in
`_claude-run.yml` and the health scan —
`gh api repos/anthropics/claude-code-action/commits/v1 --jq .sha` (same for
`actions/create-github-app-token@v2`) and replace the tags with the SHAs.
Sandbox rate limits prevented resolving the pins in this PR.

**Operational procedures**
- *Dry run*: Actions → claude-worker → Run workflow → pick a fixture from
  `scripts/agent/test/fixtures` (e.g. `02-ready-label.json`, event `issues`).
  Prints the routing decision + would-be dispatch; creates nothing.
- *Disable safely*: disable the four `claude-*` workflows in the Actions UI (or
  delete the `SUPERVISOR_ACTORS` variable to freeze new supervisor-triggered
  cycles and remove `agent:queued` labels); in-flight runs finish; nothing else
  starts.
- *Recover a stuck task*: read the control comment; fix the cause; reset by
  editing the control JSON (`cycle`, `status`) or relabel `agent:queued`
  (supervisor) to re-dispatch; delete the control comment to restart tracking
  from scratch.
- *Rotate credentials*: revoke/regenerate the App private key (Settings →
  Developer settings → GitHub Apps) and update `KLASR_APP_PRIVATE_KEY`; rotate
  `ANTHROPIC_API_KEY` in the Anthropic console; both take effect on the next
  run — no workflow change needed.

## 9. Verification performed

- `scripts/agent`: `npm test` — 48/48 node:test assertions covering
  normalization for all 15 fixture classes, allowlisting (incl. missing-config
  fail-closed), command parsing, spec validation, legal/illegal transitions,
  dedupe, cycle math, fingerprint stability, dispatch payload shape,
  control-record round-trip and cap.
- `actionlint 1.7.7` clean on all six workflows (it caught two real defects:
  reusable-workflow outputs and the removed `commit_comment` trigger); PyYAML
  parse clean; worker shell glue
  `bash -n` + runtime simulation of every inline node call.
- `apps/api` and `apps/web` suites re-run after doc/skill changes (no code
  touched): green.

## 10. Known limitations

- Actions are version-pinned, not SHA-pinned (rate-limited during
  implementation) — see §8 hardening.
- The verifier is a separate session with read-only tools, but it runs under
  the same repository automation identity; it is an internal quality gate, not
  an independent review for branch protection.
- `GITHUB_TOKEN` fallback mode has the CI-trigger gap described in §8.
- `commit_comment` is normalized and tested in `scripts/agent`, but GitHub no
  longer offers it as an Actions trigger, so no workflow can subscribe to it —
  commit-level supervision goes through PR-conversation `/agent` commands.
