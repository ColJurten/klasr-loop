# Klasr — Loop State

> Persistent memory of the engineering loop. Read at session start, update before
> session end. Keep entries short; link to issues/PRs for detail.
> Last updated: 2026-07-14 (rev. architecture)

## In progress

| Item | Branch / worktree | Owner (agent/human) | Next step |
|---|---|---|---|
| (empty) | | | |

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

- [x] 2026-07-14 — Revue d'architecture REAC (docs/ARCHITECTURE.md, ADR-001…006) : TypeScript unique (suppression FastAPI, pipeline porté en NestJS + 9 tests), suppression MinIO et Redis (pg-boss), MongoDB réduit à la collection `analyses` (compétence C8, module dédié). API : 16 tests verts.
- [x] 2026-07-14 — UI refaite selon la charte klasr (noir/blanc cassé, lavande/sauge/pêche fonctionnels, Inter + JetBrains Mono, zéro ombre) : landing complète (hero, bénéfices, étapes, témoignage, pricing), shell avec sidebar, dashboard (metric cards, zone de dépôt, file avec « Tout valider » dominant, badges de confiance, bandeau RGPD). Web : 4 tests verts, build OK.

- [x] 2026-07-14 — Starter code, all verified green: NestJS API (12-entity Prisma schema, orgs/documents/rules/classification modules, 7 unit tests), Next.js web (landing + validation queue, single-click ProposalCard, 4 tests), FastAPI intelligence (pre-filter, LLM cascade + local fallback, 11 tests), Dockerfiles + docker-compose
- [x] 2026-07-14 — Loop engineering setup: branching model, CI, skills, agents, hooks, state file

## Decisions log

- 2026-07-14 — GitHub is the code host; GitHub Actions is the CI (jury dossier note: GitLab CI equivalent documented in docs/BRANCHING.md §CI portability).
- 2026-07-14 — GitFlow-lite: main (tags only) / develop / feature / fix / hotfix / release.
- 2026-07-14 — ADR-001 TypeScript unique ; ADR-002 PostgreSQL + Mongo minimal (C8) ; ADR-003 suppression MinIO (streaming Drive) ; ADR-004 pg-boss au lieu de Redis/BullMQ ; ADR-005 monolithe modulaire + worker ; ADR-006 Compose pour la démo, K8s en bonus.

## Failures & lessons (so the loop stops repeating them)

- (none yet)

## REAC coverage notes (feeds KLASR_CONTEXT.md / jury dossier)

- Loop setup demonstrates: CI/CD design, quality gates, Git workflow industrialization.
- Starter code demonstrates: layered architecture (controller/service/repository), hexagonal port for Drive execution, multi-tenant data access design, TDD on the confirm flow, eco-design instrumentation (llmCallsUsed, UsageMetric).
