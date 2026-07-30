# ENV Examples Task

## Objective
Make `apps/api/.env.example` and `apps/web/.env.example` immediately usable for local Klasr verification without committing secrets.

## Requirements
- Reuse only environment variables actually consumed by the current source.
- API defaults must match `docker-compose.yml` (`postgres/postgres`, database `klasr`, ports 5432/27017).
- Explain the exact copy destination: API `.env`, web `.env.local`.
- The same generated `INTERNAL_API_SECRET` must be used in both files.
- Distinguish values needed for the credential-free `/demo` from values needed for real OAuth/API testing.
- Include safe placeholder values only; never real credentials.
- Use `MONGO_URL`, not `MONGODB_URL`.
- No dependency, source-code, runtime-version, architecture, or product-behavior changes.
- Use pnpm only.

## Acceptance
- Both examples cover every environment variable referenced by their application.
- PostgreSQL URL works with the repository Compose defaults.
- `pnpm --filter @klasr/api test` and `pnpm --filter @klasr/web test` pass.
- Claude read-only review returns PASS.

## REAC
C1: installer et configurer l’environnement local reproductible.
