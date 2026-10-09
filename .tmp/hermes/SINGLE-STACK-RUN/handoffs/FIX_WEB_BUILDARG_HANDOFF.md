# Web acceptance flag build argument

The production web image now receives `NEXT_PUBLIC_KLASR_ACCEPTANCE_GOOGLE_SERVICE_ACCOUNT` as a build argument. The Dockerfile exposes it only in the build stage so Next.js can inline it into the client bundle; the runtime stage remains unchanged.

Docker Compose passes the flag with a safe default of `false`. Set `NEXT_PUBLIC_KLASR_ACCEPTANCE_GOOGLE_SERVICE_ACCOUNT=true` in `.env` before rebuilding the web image to show the staging validation button.

Verified with:

- `npm run lint` from `apps/web` (passed with two existing hook-dependency warnings)
- `npm run typecheck` from `apps/web`
- `npm test` from `apps/web` (18 files, 129 tests)
- `docker compose --env-file /dev/null config --quiet`

The host did not expose a `pnpm` executable, so the equivalent package scripts were run through `npm`. No container image was built.
