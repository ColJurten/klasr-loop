# BUILD HANDOFF - env-examples

## Mode
- Codex API coding session in `/root/projects/klasr-oneshot/klasr-loop`.
- Codex itself did not invoke Claude, subagents, profiles, commit, or push.
- Hermes will run the required independent Claude review.

## Changed Files
- `apps/api/.env.example`
- `apps/web/.env.example`
- `.tmp/hermes/env-examples/BUILD_HANDOFF.md`

## Implementation Notes
- `apps/api/.env.example` now states copy destination `apps/api/.env`.
- `apps/web/.env.example` now states copy destination `apps/web/.env.local`.
- API `DATABASE_URL` is `postgresql://postgres:postgres@localhost:5432/klasr`, matching `docker-compose.yml` defaults.
- API uses `MONGO_URL=mongodb://localhost:27017`, matching the Compose MongoDB port and the source config name.
- `INTERNAL_API_SECRET` is the same safe local placeholder in both examples:
  `local-dev-internal-secret-change-before-real-oauth`.
- Credential-free `/demo` needs only the web app; API values are for full backend verification.
- No dependencies, scripts, source files, runtime versions, architecture, or product behavior were changed.

## Source/Config Evidence Read
- `/root/projects/klasr-oneshot/AGENTS.md`
- `.tmp/hermes/env-examples/SPEC.md`
- `apps/api/.env.example`
- `apps/web/.env.example`
- `docker-compose.yml`
- `package.json`
- `apps/api/package.json`
- `apps/web/package.json`
- `apps/api/src/config/configuration.ts`
- `apps/api/prisma/schema.prisma`
- `apps/api/src/main.ts`
- `apps/api/src/analyses/analyses.repository.ts`
- `apps/api/src/auth/guards/internal-service.guard.ts`
- `apps/api/src/classification/llm/anthropic.provider.ts`
- `apps/web/lib/auth.ts`
- `apps/web/lib/api.ts`
- `apps/web/app/demo/*`

## Commands Run
- `rg --files -g 'AGENTS.md' -g 'docker-compose.yml' -g 'package.json' -g '.env.example' -g 'SPEC.md' -g 'BUILD_HANDOFF.md'`
- `sed -n '1,220p' /root/projects/klasr-oneshot/AGENTS.md`
- `sed -n '1,220p' .tmp/hermes/env-examples/SPEC.md`
- `sed -n '1,220p' apps/api/.env.example`
- `sed -n '1,220p' apps/web/.env.example`
- `sed -n '1,240p' docker-compose.yml`
- `sed -n '1,220p' package.json`
- `sed -n '1,220p' apps/api/package.json`
- `sed -n '1,220p' apps/web/package.json`
- `rg "process\\.env|ConfigService|get\\(|env\\(" apps/api apps/web -g '*.ts' -g '*.tsx' -g '*.js' -g '*.mjs' -g '*.cjs'`
- `rg "DATABASE_URL|MONGO_URL|MONGODB_URL|ANTHROPIC_API_KEY|INTERNAL_API_SECRET|NEXTAUTH|GOOGLE_CLIENT|AZURE|NEXT_PUBLIC_API_URL|process\\.env" apps/api apps/web prisma -g '*'`
- `sed -n '1,220p' apps/api/src/config/configuration.ts`
- `sed -n '1,220p' apps/api/src/analyses/analyses.repository.ts`
- `sed -n '1,220p' apps/api/src/auth/guards/internal-service.guard.ts`
- `sed -n '1,260p' apps/web/lib/auth.ts`
- `sed -n '1,180p' apps/web/lib/api.ts`
- `sed -n '1,140p' apps/api/prisma/schema.prisma`
- `rg "demo|/demo|href=|signIn|NEXTAUTH|GOOGLE|AZURE|ANTHROPIC|INTERNAL_API_SECRET|NEXT_PUBLIC_API_URL" apps/web/app apps/web/components apps/web/lib apps/api/src -g '*.ts' -g '*.tsx'`
- `pnpm --filter @klasr/api test`
- `pnpm --filter @klasr/web test`
- `git diff -- apps/api/.env.example apps/web/.env.example`
- `git status --short`

## Checks
- `pnpm --filter @klasr/api test`: passed.
  - 7 test suites passed.
  - 31 tests passed.
- `pnpm --filter @klasr/web test`: passed.
  - 5 test files passed.
  - 22 tests passed.
  - Vitest printed the existing Vite CJS Node API deprecation warning.

## Product Invariants
- Files-never-leave-Drive invariant remains unchanged because no source behavior changed.
- Relevant unchanged paths:
  - `apps/api/src/classification/noop-drive.executor.ts`
  - `apps/api/src/classification/classification.service.ts`
  - `apps/api/src/analyses/analyses.repository.ts`
  - `apps/api/prisma/schema.prisma`

## Design System
- Not applicable: no UI files changed.
- Visual verification not run because this task changed env examples only.

## REAC Mapping
- C1: installer et configurer l'environnement local reproductible.

## Known Compromises
- Codex itself did not invoke Claude; Hermes will run the required independent Claude review.
