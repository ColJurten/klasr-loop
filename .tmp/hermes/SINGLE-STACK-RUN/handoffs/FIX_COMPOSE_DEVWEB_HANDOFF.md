# Compose development web handoff

The Compose stack now builds the web service with the Dockerfile's `build` target and runs `next dev` from `/app/apps/web`. This keeps the full dependency set available and gives the local acceptance path its required development environment.

Set `KLASR_ACCEPTANCE_GOOGLE_SERVICE_ACCOUNT=true` in the repository-root `.env` to enable the server-side acceptance provider. The existing `NEXT_PUBLIC_KLASR_ACCEPTANCE_GOOGLE_SERVICE_ACCOUNT` build argument remains wired for the client-side flag.

Production behavior is unchanged: the Dockerfile runtime stage still installs production dependencies, sets `NODE_ENV=production`, and runs `next start`. The production guards were not modified.

Verified with:

- `docker compose --env-file /dev/null config --quiet`

No container image was built.
