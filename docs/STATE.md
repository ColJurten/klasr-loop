# Klasr — Loop State

> Persistent memory of the engineering loop. Read at session start, update before
> session end. Keep entries short; link to issues/PRs for detail.
> Last updated: 2026-07-14 (rev. architecture)

## In progress

| Item | Branch / worktree | Owner (agent/human) | Next step |
|---|---|---|---|
| #1 Auth: NextAuth + OAuth Google/Microsoft, org onboarding | `feature/1-Auth` — `../klasr-worktrees/feature-1-Auth` (from `develop`) | unassigned | Worktree created only, no implementation started yet |

## Backlog (ordered)

1. [ ] #TBD — Auth: NextAuth + OAuth Google/Microsoft, organization onboarding
2. [ ] #TBD — Drive connector: Google Drive OAuth + folder arborescence sync (cache structure only)
3. [ ] #TBD — Prisma schema: 12-entity model, tenant scoping middleware
4. [ ] #TBD — Worker pg-boss : jobs sync Drive / OCR (node-tesseract-ocr) / classification, idempotents et scopés organisation
5. [ ] #TBD — Classification proposal flow: job pg-boss → pipeline → proposal → single-click confirm → execute move/rename
6. [ ] #TBD — Dashboard: history, à-valider queue, precision stats
7. [ ] #TBD — Rules engine: user-defined classification rules, sequential priority
8. [ ] #TBD — Eco-design instrumentation: LLM-call counter, cascade metrics

## Done

- [x] 2026-07-16 — Agent loop v2 (spec-driven, event-driven) : suppression du cron triage ; adapters intake/feedback/ci-recovery → repository_dispatch → worker (dédup, MAX_AGENT_CYCLES, concurrence par tâche) → _claude-run réutilisable ; spec klasr-agent-spec:v1 + validateur ; machine à états agent:* + commentaire de contrôle unique ; rôles orchestrator (code déterministe)/spec-writer/implementer/verifier/security-reviewer/feedback-responder ; issues auto fingerprint-dédupliquées sur échec CI branche protégée ; 48 tests node:test verts ; actionlint clean. Voir docs/AGENT_LOOP_SPEC.md.

- [x] 2026-07-14 — Revue d'architecture REAC (docs/ARCHITECTURE.md, ADR-001…006) : TypeScript unique (suppression FastAPI, pipeline porté en NestJS + 9 tests), suppression MinIO et Redis (pg-boss), MongoDB réduit à la collection `analyses` (compétence C8, module dédié). API : 16 tests verts.
- [x] 2026-07-14 — UI refaite selon la charte klasr (noir/blanc cassé, lavande/sauge/pêche fonctionnels, Inter + JetBrains Mono, zéro ombre) : landing complète (hero, bénéfices, étapes, témoignage, pricing), shell avec sidebar, dashboard (metric cards, zone de dépôt, file avec « Tout valider » dominant, badges de confiance, bandeau RGPD). Web : 4 tests verts, build OK.

- [x] 2026-07-14 — Starter code, all verified green: NestJS API (12-entity Prisma schema, orgs/documents/rules/classification modules, 7 unit tests), Next.js web (landing + validation queue, single-click ProposalCard, 4 tests), FastAPI intelligence (pre-filter, LLM cascade + local fallback, 11 tests), Dockerfiles + docker-compose
- [x] 2026-07-14 — Loop engineering setup: branching model, CI, skills, agents, hooks, state file

## Decisions log

- 2026-07-14 — GitHub is the code host; GitHub Actions is the CI (jury dossier note: GitLab CI equivalent documented in docs/BRANCHING.md §CI portability).
- 2026-07-14 — GitFlow-lite: main (tags only) / develop / feature / fix / hotfix / release.
- 2026-07-14 — ADR-001 TypeScript unique ; ADR-002 PostgreSQL + Mongo minimal (C8) ; ADR-003 suppression MinIO (streaming Drive) ; ADR-004 pg-boss au lieu de Redis/BullMQ ; ADR-005 monolithe modulaire + worker ; ADR-006 Compose pour la démo, K8s en bonus.

## Failures & lessons (so the loop stops repeating them)

- 2026-07-14 — `loop-triage` run blocked on CI/issue checks: `gh` CLI is not installed in the local environment and no `GITHUB_TOKEN`/PAT is exported to the shell (a GitHub MCP server was configured this session but requires a Claude Code restart before its tools are usable). Until one of these is available, triage can only inspect local git state, not Actions runs or issues. Action for next session: install GitHub CLI (`winget install GitHub.cli`) or confirm the `github` MCP server connects after restart, then re-run `/loop-triage`.
- 2026-07-14 (later same day) — GitHub MCP server confirmed connected and working (`claude mcp list` → Connected, verified with a live `search_repositories` call, then used against `ColJurten/klasr-loop` for issues/commits/file reads). However `gh` CLI is still not installed, and the configured MCP server is the basic `@modelcontextprotocol/server-github`, which exposes no Actions/workflow-run tools (checked via tool search — only issues/PRs/commits/files/branches). Net effect: issues and commits are now triageable via MCP, but **CI run health still cannot be checked** this session. Action for next session: either install GitHub CLI (`winget install GitHub.cli` + `gh auth login`) or swap/add an MCP server that exposes `list_workflow_runs`/`get_workflow_run` (e.g. a GitHub Actions-capable server or export `GITHUB_TOKEN` and call the REST API directly).

## Triage log

- 2026-07-14 — Repo state check only (CI/issues unavailable, see Failures & lessons above): single commit (`71001c1`, initial commit) exists on `main`/`develop`/`master` — nothing merged without an issue ref, no stale in-progress branches. `docs/STATE.md` In progress table is empty; Backlog order unchanged (no new signal to reprioritize). No code modified.
- 2026-07-14 (later same day) — Re-ran via GitHub MCP (now connected) against `ColJurten/klasr-loop`: **0 issues** exist (open or closed) — nothing to label, nothing stale. **1 commit total** on the repo (`71001c1`, initial commit, matches local `main`) — nothing merged without an issue ref. `.github/workflows/` has `ci.yml`, `claude-triage.yml`, `release.yml` present, but their run history could not be checked (see Failures & lessons — no Actions-runs tool available, `gh` still missing). Backlog/In-progress unchanged, no new signal to reprioritize. No code modified.

## REAC coverage notes (feeds KLASR_CONTEXT.md / jury dossier)

- Loop setup demonstrates: CI/CD design, quality gates, Git workflow industrialization.
- Starter code demonstrates: layered architecture (controller/service/repository), hexagonal port for Drive execution, multi-tenant data access design, TDD on the confirm flow, eco-design instrumentation (llmCallsUsed, UsageMetric).
