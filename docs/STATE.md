# Klasr — Loop State

> Persistent memory of the engineering loop. Read at session start, update before
> session end. Keep entries short; link to issues/PRs for detail.
> Last updated: 2026-07-16 (nightly triage)

## In progress

| Item | Branch / worktree | Owner (agent/human) | Next step |
|---|---|---|---|
| #1 Auth: NextAuth + OAuth Google/Microsoft, org onboarding | feature/1-Auth (PR #3) | — | PR #3 green + mergeable → human review & merge to develop |

## Backlog (ordered)

1. [ ] #6 — chore(ci): back-merge main → develop (triage `id-token: write` fix + agent plugins missing on develop) — priority-medium
2. [ ] #2 — API: enforce request auth + tenant-scoped authorization (organizationId from session, not URL) — security, priority-high
3. [ ] #TBD — Drive connector: Google Drive OAuth + folder arborescence sync (cache structure only)
4. [ ] #TBD — Prisma schema: 12-entity model, tenant scoping middleware
5. [ ] #TBD — Worker pg-boss : jobs sync Drive / OCR (node-tesseract-ocr) / classification, idempotents et scopés organisation
6. [ ] #TBD — Classification proposal flow: job pg-boss → pipeline → proposal → single-click confirm → execute move/rename
7. [ ] #TBD — Dashboard: history, à-valider queue, precision stats
8. [ ] #TBD — Rules engine: user-defined classification rules, sequential priority
9. [ ] #TBD — Eco-design instrumentation: LLM-call counter, cascade metrics

## Done

- [x] 2026-07-14 — Revue d'architecture REAC (docs/ARCHITECTURE.md, ADR-001…006) : TypeScript unique (suppression FastAPI, pipeline porté en NestJS + 9 tests), suppression MinIO et Redis (pg-boss), MongoDB réduit à la collection `analyses` (compétence C8, module dédié). API : 16 tests verts.
- [x] 2026-07-14 — UI refaite selon la charte klasr (noir/blanc cassé, lavande/sauge/pêche fonctionnels, Inter + JetBrains Mono, zéro ombre) : landing complète (hero, bénéfices, étapes, témoignage, pricing), shell avec sidebar, dashboard (metric cards, zone de dépôt, file avec « Tout valider » dominant, badges de confiance, bandeau RGPD). Web : 4 tests verts, build OK.

- [x] 2026-07-14 — Starter code, all verified green: NestJS API (12-entity Prisma schema, orgs/documents/rules/classification modules, 7 unit tests), Next.js web (landing + validation queue, single-click ProposalCard, 4 tests), FastAPI intelligence (pre-filter, LLM cascade + local fallback, 11 tests), Dockerfiles + docker-compose
- [x] 2026-07-14 — Loop engineering setup: branching model, CI, skills, agents, hooks, state file

## Decisions log

- 2026-07-14 — GitHub is the code host; GitHub Actions is the CI (jury dossier note: GitLab CI equivalent documented in docs/BRANCHING.md §CI portability).
- 2026-07-14 — GitFlow-lite: main (tags only) / develop / feature / fix / hotfix / release.
- 2026-07-14 — ADR-001 TypeScript unique ; ADR-002 PostgreSQL + Mongo minimal (C8) ; ADR-003 suppression MinIO (streaming Drive) ; ADR-004 pg-boss au lieu de Redis/BullMQ ; ADR-005 monolithe modulaire + worker ; ADR-006 Compose pour la démo, K8s en bonus.

## Triage notes

- 2026-07-16 — Nightly triage:
  - **CI health.** Two failures in the recent window, both understood:
    - Triage run 29391146095 (2026-07-15) failed — `claude-code-action@v1`: "Could not fetch an OIDC token" → missing `id-token: write` in `claude-triage.yml`. Fixed on `main` (PR #5), but **not yet on `develop`** → issue #6.
    - CI run 29333836239 (2026-07-14, `main`) failed — `dorny/paths-filter@v3`: "couldn't find remote ref master". No longer reproduces; recent CI on main/develop is green. One-time setup artifact.
  - **Branch hygiene.** `develop` is 4 commits behind `main` (PRs #4/#5 merged straight to `main`, bypassing `develop`) — GitFlow-lite violation. Tracked in #6.
  - **PRs.** #3 (Auth, issue #1) is green, mergeable — awaiting human review/merge to `develop`.
  - **Issues.** All open issues (#1, #2) are labeled; no unlabeled or stale (>5d) items. Backlog re-linked to real issue numbers. Created labels `ci-failure`, `priority-medium`.

## Failures & lessons (so the loop stops repeating them)

- 2026-07-16 — Fixes merged directly to `main` don't reach `develop` automatically; `develop` silently fell behind and kept a broken `claude-triage.yml`. Lesson: land integration changes on `develop` first, and back-merge `main` → `develop` after any hotfix.

## REAC coverage notes (feeds KLASR_CONTEXT.md / jury dossier)

- Loop setup demonstrates: CI/CD design, quality gates, Git workflow industrialization.
- Starter code demonstrates: layered architecture (controller/service/repository), hexagonal port for Drive execution, multi-tenant data access design, TDD on the confirm flow, eco-design instrumentation (llmCallsUsed, UsageMetric).
