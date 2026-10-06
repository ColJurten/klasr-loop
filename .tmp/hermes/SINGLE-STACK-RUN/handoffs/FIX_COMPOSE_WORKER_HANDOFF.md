# Compose worker and readiness handoff

## Diff summary

- Added a standalone `worker` that runs `python src/worker.py` with `KLASR_WORKER=true`.
- Reused the API build and `klasr-api:local` image for the worker, so the heavy Python image has one tag/build definition.
- Added the existing `apps/web/Dockerfile` as the `web` service.
- Added PostgreSQL, MongoDB, and API healthchecks. Both Python services wait for healthy databases; the web waits for the healthy API.
- Documented the worker flags in `apps/api-py/.env.example` and Compose values in the web example.

## Profiles and services

`api`, `worker`, and `web` use the existing `api` profile. PostgreSQL and MongoDB remain unprofiled, preserving the existing database-only `docker compose up` workflow while `--profile api` starts the complete stack. The worker publishes no ports.

## Quickstart and progress logs

Create a repository-root `.env` with `INTERNAL_API_SECRET`, `TOKEN_ENCRYPTION_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `NEXTAUTH_SECRET`, then run:

```sh
docker compose --profile api up --build
```

Provider/LLM credentials remain configured in the UI. Follow the verbose analysis path—including Docling, RapidOCR, and LLM activity—in the API and worker logs:

```sh
docker compose logs -f worker api
```

Stop the stack with:

```sh
docker compose --profile api down
```
