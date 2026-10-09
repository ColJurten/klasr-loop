# Web Dockerfile pnpm workspace fix

## Layout

- `apps/web/Dockerfile` builds from the repository root with Node 20 Alpine, Corepack, pnpm 10.15.1 from the root `packageManager`, and the frozen root lockfile.
- The build stage installs the `@klasr/web` workspace dependencies and runs its real `next build` script.
- The `web` runtime stage installs production-only dependencies and copies `.next`, `public`, and `next.config.mjs`, then runs `pnpm --filter @klasr/web start`.
- The root `.dockerignore` keeps local dependencies, build outputs, virtualenvs, secrets, and non-pnpm lockfiles out of the root Docker context.

## Compose change

The `web` service now uses repository-root context `.` and `apps/web/Dockerfile`. Its ports, environment, and healthy `api` dependency are unchanged.

## Verification

- `docker compose --env-file /dev/null config --quiet` passed.
- `docker build --target web -f apps/web/Dockerfile .` passed, including the frozen pnpm install and production Next build.
- The host did not have a `pnpm` executable, so a separate host-side build was unnecessary after the Docker build passed.
- The API image was not built.

Existing non-fatal `react-hooks/exhaustive-deps` warnings in `app/dashboard/drive-workflow.tsx` were left untouched.

## Expected commands

```sh
docker compose --env-file /dev/null config --quiet
docker build --target web -f apps/web/Dockerfile .
docker compose --profile api up --build
```
