# Klasr Loop Engineering Setup

This document maps the six loop-engineering components (Addy Osmani,
"Loop Engineering", 2026) to their concrete implementation in this repo.
The goal: I design the system once; the system prompts the agents.

## 1. Automations — the heartbeat

Discovery and triage run without me:

- **Nightly triage (unattended):** `.github/workflows/claude-triage.yml` runs Claude Code on a cron schedule. Its prompt invokes the `loop-triage` skill: read yesterday's CI failures, open issues, and recent commits; write findings into `docs/STATE.md`; open GitHub issues for anything actionable.
- **In-session, run-until-done:** use `/goal` in Claude Code with a verifiable stop condition, e.g. `/goal all tests in apps/api pass and lint is clean`. A separate model checks completion, so the maker isn't grading itself. Use `/loop` for cadence-based re-runs inside a session.
- **Hooks (deterministic, always-on):** `.claude/settings.json` runs lint on every file edit and reminds the agent to update STATE.md at session stop. Rules that must ALWAYS execute live in hooks, not prompts.

## 2. Worktrees — parallel without collisions

- One task = one worktree = one branch. Create with `scripts/new-worktree.sh feature/42-rule-engine`.
- Subagents that write code declare `isolation: worktree` in their frontmatter (`implementer`), so each parallel helper gets its own checkout that cleans itself up.
- Human ceiling: review bandwidth, not tooling, limits how many parallel loops run. Default: max 2–3 concurrent worktrees.

## 3. Skills — codified project knowledge

Located in `.claude/skills/`, auto-invoked by description match or explicitly with `/name`:

| Skill | Purpose |
|---|---|
| `klasr-product` | Domain model, personas, REAC/jury constraints, eco-design rules |
| `backend-conventions` | NestJS layered architecture, Prisma, BullMQ, multi-tenant rules |
| `frontend-conventions` | Next.js 14 App Router, shadcn/ui, single-click confirmation UX |
| `git-workflow` | Branching model, Conventional Commits, PR checklist |
| `loop-triage` | The recurring triage procedure called by the nightly automation |
| `release` | Cut a release branch, changelog, tag, artifact publication |

Rule of thumb: always-true one-liners go in `CLAUDE.md`; multi-step procedures go in skills. When these mature, bundle them as a plugin to share across repos.

## 4. Plugins & connectors (MCP) — touch real tools

- **GitHub MCP server**: read/label issues, open PRs, comment — lets the loop act instead of describing. Add with `claude mcp add`.
- **Postgres MCP (read-only, local dev DB)**: lets the verifier inspect actual schema/tenant scoping.
- Later: Sentry/observability MCP once staging exists; Linear/GitHub Projects as an alternative state board.
- Packaging: once skills+agents stabilize, ship them as a Claude Code plugin so the setup is one install (also a nice jury exhibit for industrialization).

## 5. Sub-agents — maker/checker split

Defined in `.claude/agents/`:

| Agent | Role | Notes |
|---|---|---|
| `planner` | Explore + plan, read-only | Cheap/fast model, never edits |
| `implementer` | Writes the code | `isolation: worktree`, preloads convention skills |
| `verifier` | Reviews diff vs. skills + runs tests | No Write/Edit tools; different perspective from maker |
| `security-reviewer` | OAuth, multi-tenant, upload, RGPD review | Strongest model; mandatory for auth/tenant/file-handling diffs |

The verifier being unable to edit is the point: "done" is a claim it must justify against tests and conventions, not patch over.

## 6. State — memory outside the context window

- `docs/STATE.md` is the spine: Backlog / In progress / Done / Decisions / Failures / REAC coverage. Every session and every automation reads it first and writes it last. The agent forgets; the repo doesn't.
- GitHub Issues are the canonical backlog for anything user-visible; STATE.md links to them and holds the finer-grained loop state.

## One full cycle (the shape)

1. Nightly automation triages CI + issues → updates STATE.md, opens/labels issues.
2. Morning: I pick items, or start `/goal` on a chosen item.
3. `planner` explores and produces a short plan appended to the issue.
4. `implementer` executes in a fresh worktree on a `feature/*` or `fix/*` branch.
5. `verifier` (and `security-reviewer` when relevant) reviews; failures loop back to step 4.
6. PR opened via GitHub MCP/`gh`; CI (lint/test/build/SonarQube) must be green.
7. I review the diff myself — verification stays my job — then merge to `develop`.
8. STATE.md updated; the next run picks up where this one stopped.

## Guardrails (what the loop does NOT replace)

- I confirm the code works before shipping (comprehension debt is real).
- Token budget: subagents are spent where a second opinion pays (security, tenant isolation), not on trivial edits.
- If the loop and I disagree, the loop is wrong until proven otherwise.
