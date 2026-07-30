# Klasr One-Shot App — Implementation Specification

Task ID: `one-shot-app`
Repository: `/root/projects/klasr-oneshot/klasr-loop`
Base/target branch: `main` (`develop` is stale and must not be used)
Binding contract: `/root/projects/klasr-oneshot/AGENTS.md`

## Objective

Turn the existing Klasr monorepo into a coherent, self-contained, jury-ready local MVP that demonstrates the complete user-facing classification-review journey: understand the product, enter a safe demo workspace, inspect AI/rule proposals, correct a destination, validate one proposal or all proposals, observe success/error/empty states, and inspect recent activity. Preserve the existing NestJS classification confirmation path and all privacy/tenant invariants.

This is a one-shot delivery of a demonstrable application, not a claim that production Google Drive/OneDrive, OCR, LLM credentials, or deployment are configured.

## Current state

- Existing Next.js 14 landing page, auth shell, dashboard, proposal cards, and fallback proposals.
- Existing NestJS modules and classification list/confirm flow through `DriveExecutor` and repository layers.
- Existing PostgreSQL/Prisma schema and one MongoDB `analyses` collection.
- Existing tests in Jest, Vitest, and `node:test`.
- Package manifests currently exist per workspace with npm lockfiles; no root pnpm workspace exists.
- Runtime available on the host: Node.js 22.23.1. Do not change it.
- Preserve all dependency/framework versions currently declared in package manifests, especially Next.js 14.2.5, React 18.3.1, NestJS 10.3.9, Prisma 5.16.1, and TypeScript 5.5.3 ranges. Do not silently upgrade or downgrade.

## Scope in

### 1. pnpm-only monorepo operation

- Add the minimum root workspace configuration needed to run the repository with pnpm only.
- Preserve declared dependency/framework versions; do not introduce a new runtime.
- Root scripts must make the required checks discoverable and runnable across `apps/api`, `apps/web`, and `scripts/agent` where applicable.
- Do not invoke npm or npx at any point.

### 2. Jury-ready web vertical slice

- Keep and refine the existing landing page and protected application shell.
- Add a clearly labelled, self-contained demo entry that requires no OAuth secrets and uses only fictional seeded metadata; it must never contain or upload real document bytes.
- Build a polished review workspace using the locked Klasr design system:
  - monochrome ink/paper base;
  - lavande only for accent, sauge for validation, pêche for attention/new folder;
  - Inter 400/500 UI typography and JetBrains Mono for filenames/paths;
  - zero shadows and zero gradients;
  - bar-built K logo SVG;
  - responsive layout and visible keyboard focus.
- Review queue requirements:
  - multiple realistic fictional proposals suitable for a jury demo;
  - confidence badges with accessible text, not colour alone;
  - dominant `Tout valider` action;
  - per-row `Valider` action;
  - a proper in-product correction interaction (no `window.prompt`);
  - loading, success, partial-failure, retry, and empty states;
  - truthful RGPD banner: bytes are streamed from the connected Drive to OCR and discarded; Klasr never persists document content; rename/move occurs only after explicit validation;
  - recent-activity/history presentation using fictional metadata;
  - no external CDN/design dependency.
- The demo must be deterministic and locally launchable for browser verification.

### 3. API and product invariants

- Preserve and, where needed for the UI contract, tighten the existing proposal list/confirm flow.
- Never execute or record a rename/move before explicit validation.
- Preserve organization scoping on every touched query or route.
- Keep Drive execution behind `DriveExecutor`; do not add direct vendor calls elsewhere.
- Do not persist document bytes/content or log document content.
- Keep MongoDB access limited to the single TTL-purged `analyses` collection.
- Add behavior-focused tests before production behavior changes (RED → GREEN → REFACTOR).

### 4. Documentation

- Update `docs/STATE.md` in French with the delivered one-shot MVP, verification evidence, compromises, and precise REAC mapping.
- Keep temporary build/review handoffs under `.tmp/hermes/one-shot-app/`.

## Scope out

- Real Google/Microsoft OAuth credentials or real client documents.
- Production Drive mutation against a live account.
- Production OCR/LLM provider credentials.
- New datastore, broker, cache, object store, service, runtime, or framework.
- Redis, BullMQ, MinIO, or Python.
- Unrelated refactors, file/folder renames, framework upgrades, deployment, billing, or production monitoring.
- Claiming that simulated demo adapters are production integrations.

## Acceptance criteria

1. A fresh reviewer can use pnpm-only root commands to install and run all available checks without npm/npx.
2. The local web app exposes a clear path to a deterministic demo workspace without OAuth/provider secrets.
3. The review screen is camera-ready and complies with every locked design-system rule.
4. Fictional proposals display filename, destination, source, and accessible confidence indication.
5. Per-row `Valider` is idempotent in the UI; a second click cannot cause duplicate execution.
6. `Tout valider` is visually dominant, handles partial failures, and leaves failed rows retryable.
7. Correction uses an accessible in-product form/dialog and applies only after explicit confirmation.
8. Success, error, retry, partial-failure, and empty states are sane and tested.
9. RGPD copy matches real architecture and never implies document content is persisted.
10. Existing API classification tests remain green; touched API paths remain organization-scoped and execute Drive mutation before recording confirmation.
11. No secret, real client data, token, or document content is introduced.
12. No new datastore/runtime/framework is introduced and no pinned version is changed.
13. `docs/STATE.md` records the delivery and maps it to REAC competencies.
14. Claude Code Sonnet returns `PASS` after reviewing the final diff in read/check mode without editing files.
15. Final browser verification demonstrates the affected screens at desktop and narrow/mobile widths.

## Targeted REAC competencies (RNCP 37873)

- C1 — pnpm-only reproducible local environment and documented commands.
- C2 — responsive, accessible Next.js user interface and complete validation interaction.
- C3 — classification confirmation behavior and Drive execution port.
- C4 — spec-driven Kanban audit trail and independent builder/reviewer workflow.
- C5 — needs analysis and camera-ready interaction states derived from product requirements.
- C6 — preservation of the documented modular architecture and ADR constraints.
- C7 — preservation of PostgreSQL/Prisma relational model and transaction boundaries.
- C8 — preservation of SQL repositories plus the single TTL MongoDB analyses repository.
- C9 — Jest, Vitest, node:test, build, and browser verification evidence.
- C10 — reproducible local build/run workflow.
- C11 — quality gates and independent review evidence.

## Required checks

Run what exists and report missing scripts explicitly; do not silently skip:

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Also:

- Run targeted tests during TDD cycles.
- Run `actionlint` only if a GitHub Actions workflow changes.
- Launch the web application locally and visually verify landing/demo/review states in a browser at desktop and mobile widths.
- Record exact commands and results in `.tmp/hermes/one-shot-app/BUILD_HANDOFF.md`.

## Stop conditions

Stop and report a blocker instead of improvising if:

- Codex model `gpt-5.5` is unavailable.
- Claude Sonnet is unavailable.
- A pinned framework/runtime version cannot be installed.
- Satisfying the task would require a new datastore/runtime/service, a version downgrade/upgrade, real secrets/documents, or renaming/moving files without user validation.

## Builder operating contract

Use Codex CLI directly with model `gpt-5.5`. Codex CLI has no Hermes `/goal` command in non-interactive execution, so use `codex exec` as the documented fallback. Read this specification, the binding parent `AGENTS.md`, repository `CLAUDE.md`, `docs/ARCHITECTURE.md`, and `docs/STATE.md` before editing. Use pnpm only. Follow TDD for behavior changes. Do not commit or push.

The builder handoff must include changed files, commands, checks, visual URL if launched, invariant evidence, design-system compliance, REAC mapping, and compromises.
