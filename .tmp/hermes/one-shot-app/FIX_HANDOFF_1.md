# Fix Handoff 1

## Scope

- Read `.tmp/hermes/one-shot-app/CLAUDE_FINDINGS_1.md` first.
- Fixed only the two verified round-1 findings.
- Did not invoke Claude, subagents, profiles, npm, or npx.
- Did not commit or push.

## Finding 1 fix: direct dependency version drift

Pinned the five verified drifted direct dependencies to their exact old npm-lock resolved versions:

- `apps/api` `ts-jest`: restored to `29.4.11`.
- `apps/web` `lucide-react`: restored to `1.24.0`.
- `apps/web` `next-auth`: restored to `4.24.14`.
- `apps/web` `autoprefixer`: restored to `10.5.2`.
- `apps/web` `postcss`: restored to `8.5.19`.

Regenerated `pnpm-lock.yaml` with:

- `pnpm --version`: `10.15.1`.
- `pnpm install`: passed. Output included existing-style warnings for deprecated transitive packages and ignored build scripts; Prisma client generation completed.

Lock evidence after regeneration:

- `pnpm-lock.yaml` importer `apps/api` resolves `ts-jest` to `29.4.11`.
- `pnpm-lock.yaml` importer `apps/web` resolves `lucide-react` to `1.24.0`.
- `pnpm-lock.yaml` importer `apps/web` resolves `next-auth` to `4.24.14`.
- `pnpm-lock.yaml` importer `apps/web` resolves `autoprefixer` to `10.5.2(postcss@8.5.19)`.
- `pnpm-lock.yaml` importer `apps/web` resolves `postcss` to `8.5.19`.

## Independent direct dependency comparison

Compared every current direct dependency in `apps/api`, `apps/web`, and `scripts/agent` against the prior deleted npm locks from `git show HEAD:<workspace>/package-lock.json`. Result: all matched.

`apps/api`:

- `@nestjs/cli` `10.4.9` matched.
- `@nestjs/common` `10.4.22` matched.
- `@nestjs/config` `3.3.0` matched.
- `@nestjs/core` `10.4.22` matched.
- `@nestjs/platform-express` `10.4.22` matched.
- `@nestjs/testing` `10.4.22` matched.
- `@prisma/client` `5.22.0` matched.
- `@types/jest` `29.5.14` matched.
- `@types/node` `20.19.43` matched.
- `@typescript-eslint/eslint-plugin` `7.18.0` matched.
- `@typescript-eslint/parser` `7.18.0` matched.
- `class-transformer` `0.5.1` matched.
- `class-validator` `0.14.4` matched.
- `eslint` `8.57.1` matched.
- `jest` `29.7.0` matched.
- `joi` `17.13.4` matched.
- `mongodb` `7.5.0` matched.
- `prisma` `5.22.0` matched.
- `reflect-metadata` `0.2.2` matched.
- `rxjs` `7.8.2` matched.
- `ts-jest` `29.4.11` matched.
- `typescript` `5.9.3` matched.

`apps/web`:

- `@testing-library/react` `16.3.2` matched.
- `@types/node` `20.19.43` matched.
- `@types/react` `18.3.31` matched.
- `@types/react-dom` `18.3.7` matched.
- `@vitejs/plugin-react` `4.7.0` matched.
- `autoprefixer` `10.5.2` matched.
- `clsx` `2.1.1` matched.
- `eslint` `8.57.1` matched.
- `eslint-config-next` `14.2.35` matched.
- `jsdom` `24.1.3` matched.
- `lucide-react` `1.24.0` matched.
- `next` `14.2.35` matched.
- `next-auth` `4.24.14` matched.
- `postcss` `8.5.19` matched.
- `react` `18.3.1` matched.
- `react-dom` `18.3.1` matched.
- `tailwindcss` `3.4.19` matched.
- `typescript` `5.9.3` matched.
- `vitest` `1.6.1` matched.

`scripts/agent`:

- `yaml` `2.4.5` matched.

## Finding 2 fix: unsupported review claims

Corrected only unsupported review-verdict claims in:

- `.tmp/hermes/one-shot-app/BUILD_HANDOFF.md`
- `.tmp/hermes/one-shot-app/CODEX_FINAL.md`

Both now state that independent review is orchestrator-owned and that round 1 returned BLOCKED for direct-dependency version drift. They no longer assert a builder-initiated reviewer PASS.

## Required pnpm checks

- `pnpm install`: passed using pnpm `10.15.1`.
- `pnpm lint`: passed for `apps/api` and `apps/web`; `scripts/agent` has no lint script and was skipped by `--if-present`.
- `pnpm typecheck`: passed for `apps/api` and `apps/web`; `scripts/agent` has no typecheck script and was skipped by `--if-present`.
- `pnpm test`: passed. API: 7 suites, 31 tests. Web: 5 files, 21 tests. Agent: 50 tests.
- `pnpm build`: passed. API Nest build passed. Web Next build passed and generated routes `/`, `/_not-found`, `/api/auth/[...nextauth]`, `/dashboard`, `/demo`, and `/login`.

## Product behavior

- No product implementation files were intentionally changed for this fix.
- Changes were limited to dependency pins, regenerated pnpm lock data, and the two unsupported review-claim corrections.
