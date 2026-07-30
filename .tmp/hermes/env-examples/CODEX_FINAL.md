Implemented the env example spec with changes limited to:

- [apps/api/.env.example](/root/projects/klasr-oneshot/klasr-loop/apps/api/.env.example)
- [apps/web/.env.example](/root/projects/klasr-oneshot/klasr-loop/apps/web/.env.example)
- [.tmp/hermes/env-examples/BUILD_HANDOFF.md](/root/projects/klasr-oneshot/klasr-loop/.tmp/hermes/env-examples/BUILD_HANDOFF.md)

The examples now state the exact copy destinations, separate credential-free `/demo` verification from optional real OAuth/API setup, use safe placeholders only, keep `MONGO_URL`, match the Compose PostgreSQL defaults, and use the same `INTERNAL_API_SECRET` placeholder in both apps.

Verification run with pnpm only:

```bash
pnpm --filter @klasr/api test
pnpm --filter @klasr/web test
```

Both passed: API `31/31` tests, web `22/22` tests. Claude review was not run because you explicitly instructed not to invoke Claude/subagents/profiles. No commit or push was performed.