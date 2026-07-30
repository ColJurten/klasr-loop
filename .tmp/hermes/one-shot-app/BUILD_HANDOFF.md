# Builder Handoff — one-shot-app

## Mode

- Codex CLI mode used: `codex exec` fallback, per SPEC/user instruction.
- Hermes profiles/subagents: not used.
- Commits/pushes: none.

## Changed files

- Added root pnpm workspace: `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`.
- Removed npm lockfiles: `apps/api/package-lock.json`, `apps/web/package-lock.json`, `scripts/agent/package-lock.json`.
- Added/updated scripts: `apps/api/package.json`, `apps/web/package.json`.
- Web MVP/demo: `apps/web/app/demo/page.tsx`, `apps/web/app/demo/demo-workspace.tsx`, `apps/web/app/page.tsx`, `apps/web/app/dashboard/page.tsx`, `apps/web/app/dashboard/proposal-queue.tsx`, `apps/web/components/proposal-card.tsx`, `apps/web/components/logo.tsx`, `apps/web/components/ui/card.tsx`, `apps/web/app/layout.tsx`, `apps/web/app/login/login-form.tsx`.
- Tests: `apps/web/tests/proposal-card.test.tsx`, `apps/web/tests/proposal-queue.test.tsx`, `apps/web/tests/dashboard-session.test.tsx`.
- Documentation: `docs/STATE.md`.

## Commands run

- `pnpm install` — passed. Warnings: deprecated transitive packages; pnpm build-script approval warning after Prisma generation.
- RED targeted test: `pnpm --dir apps/web test -- tests/proposal-card.test.tsx tests/proposal-queue.test.tsx` — first failed before install (`vitest` missing), then failed on expected old behavior (`window.prompt`, missing accessible confidence/retry/partial state).
- GREEN targeted test: `pnpm --dir apps/web test -- tests/proposal-card.test.tsx tests/proposal-queue.test.tsx` — passed, 21 web tests.
- `pnpm lint` — passed for API and web. `scripts/agent` has no lint script.
- `pnpm typecheck` — passed for API and web. `scripts/agent` has no typecheck script.
- `pnpm test` — passed: API 31 Jest tests, web 21 Vitest tests, agent 50 `node:test` tests.
- `pnpm build` — passed: API Nest build and web Next build; `/demo` included as a static route.
- Launch: `pnpm --dir apps/web dev --hostname 127.0.0.1 --port 3000` — passed.
- Route checks: `curl -I http://127.0.0.1:3000/` and `curl -I http://127.0.0.1:3000/demo` — both HTTP 200. `curl -s http://127.0.0.1:3000/demo | rg "Espace démo local|Validation de classement|RGPD|Tout valider"` confirmed expected page content.
- Independent review is orchestrator-owned. Round 1 returned BLOCKED for direct-dependency version drift during the pnpm migration; this builder handoff records no builder-initiated reviewer verdict.

## Checks passed and failed

- Passed: `pnpm install`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
- Passed: local launch and HTTP route checks for `/` and `/demo`.
- Independent orchestrator-owned review round 1 returned BLOCKED for version drift.
- Initial RED failures were intentional for TDD and fixed.
- Visual screenshot verification: not completed. No `chromium`, `chromium-browser`, `google-chrome`, or `google-chrome-stable` binary is available on the host. I did not add browser tooling or install external visual-test dependencies.

## Local URL

- `http://127.0.0.1:3000/`
- `http://127.0.0.1:3000/demo`

## Product invariant evidence

- Production confirmation path remains in `apps/api/src/classification/classification.service.ts`: `confirm()` reads a pending proposal scoped by `organizationId`, calls `DriveExecutor.moveAndRename(...)` first, and only then records the decision/audit transaction. If Drive execution fails, `confirmTransaction()` is not called.
- Repository scoping remains in `apps/api/src/classification/proposals.repository.ts`: `listPending()`, `findPending()`, and transaction updates filter by `organizationId`.
- Web dashboard still calls `confirmProposal()` from `apps/web/lib/api.ts`, which posts to `/organizations/:organizationId/proposals/:proposalId/confirm`.
- `/demo` injects a local fake `onConfirmProposal` into `ProposalQueue`; it uses fictional metadata only, performs no Drive/OCR/LLM/vendor call, stores no bytes/content, and clearly labels itself as a local demo.
- MongoDB access was not touched; the single `analyses` collection invariant remains unchanged.

## Design-system compliance

- Monochrome ink/paper base with functional pastels only: lavande accent, sauge validation, pêche attention/new folder/error.
- No shadows, no gradients, no external font/CDN links. Font families remain `Inter` and `JetBrains Mono` via local/system fallback names.
- Bar-built K logo SVG preserved.
- Cards and controls use 8px radius (`rounded-lg`) on affected screens.
- Confidence badges include accessible text with percentage and source, not colour alone.
- `Tout valider` remains the dominant queue action.
- Focus-visible styling remains in `apps/web/app/globals.css`.

## REAC mapping

- C1: pnpm-only root workspace and reproducible commands.
- C2: responsive, accessible Next.js review UI with correction, retry, empty/success/error states.
- C3: confirmation path and `DriveExecutor` invariant preserved.
- C4/C5: spec-driven one-shot delivery and jury-oriented demo state coverage.
- C6: documented architecture constraints preserved; no new datastore/runtime/service/framework.
- C7/C8: PostgreSQL/Prisma and single Mongo `analyses` collection left intact.
- C9: Jest, Vitest, node:test, build, and launch evidence.
- C10/C11: root quality gates and local build/run workflow.

## Known compromises

- Browser screenshot verification could not be captured because the host has no browser binary. Launchability was verified by Next dev server plus HTTP 200/content checks.
- `scripts/agent` only exposes `test`; root `lint`, `typecheck`, and `build` use `--if-present` and therefore run where scripts exist.
- The `/demo` failure is intentionally simulated on first attempt for one row; it is not a production connector failure.
