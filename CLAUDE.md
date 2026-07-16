# Klasr — Project Memory (CLAUDE.md)

Klasr is a multi-tenant micro-SaaS for intelligent automated document classification.
It connects to cloud storage (Google Drive, OneDrive), analyzes incoming documents
via OCR + LLM, proposes a filename + destination folder inside the user's own
arborescence, and **executes** the rename/move after a single-click confirmation.
Target users: experts-comptables, lawyers, small businesses, freelancers.

This project is also the "fil rouge" for a CDA titre professionnel (RNCP niveau 6,
Simplon). Architectural decisions must be jury-legible: prefer explicit layered
architecture and documented trade-offs over clever shortcuts.

## Repository layout (monorepo)

- `apps/api/` — NestJS (TypeScript) modular monolith. Layered: controller → service → repository (Prisma/PostgreSQL, 12 entities). The classification pipeline (rule pre-filter → OCR → LLM cascade behind an abstraction) lives in `src/classification`; async jobs run on pg-boss (PostgreSQL) in a worker process. `src/analyses` is the ONLY MongoDB access (one `analyses` collection, TTL-purged) — it exists to demonstrate REAC C8 (SQL **and NoSQL** data access).
- `apps/web/` — Next.js 14 (App Router), TypeScript, Tailwind with the Klasr charte tokens, NextAuth.
- ONE language (TypeScript) everywhere, NO Redis, NO MinIO, NO Python — see docs/ARCHITECTURE.md (ADR-001…006) before proposing to add any technology.
- `docs/` — living documentation. `docs/STATE.md` is the loop's memory (see below).
- `.claude/` — skills, agents, hooks powering the engineering loop.

## Non-negotiable invariants

1. Files NEVER leave the user's Drive. Bytes are streamed from the Drive API into the OCR step and discarded — no object storage, no content at rest. Never persist document content in PostgreSQL; MongoDB `analyses` holds excerpts only, TTL-purged.
2. Every classification action requires explicit user confirmation before execution (single-click flow).
3. LLM calls go through the provider abstraction in `apps/api/src/classification/llm` — never call a vendor API outside that folder.
4. Pre-filter before LLM: skip the LLM when rules/metadata suffice (eco-design + cost).
5. Multi-tenant isolation: every query is scoped by `organizationId`. No cross-tenant reads, ever.
6. RGPD: no document content in logs; OCR metadata in MongoDB is purgeable per tenant.

## Commands

- API: `cd apps/api && npm run lint && npm run test && npm run build`
- Web: `cd apps/web && npm run lint && npm run test && npm run build`
- Local datastores: `docker compose up -d` (postgres, mongo)

## Git workflow (summary — full rules in docs/BRANCHING.md and the git-workflow skill)

- `main` = production, tags `vX.Y.Z` only. `develop` = integration.
- Branches: `feature/<issue>-<slug>`, `fix/<issue>-<slug>`, `hotfix/<slug>` (from main), `release/vX.Y.Z`.
- Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`, `ci:`). SemVer releases.
- Never commit directly to `main` or `develop`. Every change goes through a PR with green CI.

## The loop (see docs/LOOP.md)

- `docs/STATE.md` is the persistent memory of the loop. **Read it at session start. Update it before ending any session or subagent task**: move items between Backlog / In progress / Done, record decisions and failures.
- Work happens in git worktrees (`scripts/new-worktree.sh <type>/<name>`), one per parallel task.
- The maker never grades its own homework: after implementing, hand the diff to the `verifier` agent (and `security-reviewer` for auth/tenant/upload code).
- REAC competency coverage: when a feature demonstrates a REAC competency, note it in `docs/STATE.md` under "REAC coverage" (feeds KLASR_CONTEXT.md and the jury dossier).

## Definition of Done

Lint clean, tests pass (new code has tests), no cross-tenant leak possible, STATE.md updated, PR description explains the "why", CI green.


## Agent loop
The event-driven agent system (states, roles, security model, configuration) is specified in `docs/AGENT_LOOP_SPEC.md`. Orchestration is deterministic code under `scripts/agent/` — run `npm test` there before changing it.
