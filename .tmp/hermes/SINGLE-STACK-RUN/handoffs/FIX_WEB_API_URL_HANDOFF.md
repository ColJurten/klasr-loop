# Web server API URL handoff

## Result

- Server-side authentication and registration fetches now resolve `API_URL` before `NEXT_PUBLIC_API_URL`, retaining the localhost default.
- Browser-side API resolution in `apps/web/lib/api.ts` remains unchanged and `NEXT_PUBLIC_API_URL`-only.
- The web compose service documents that OAuth must be opened at exactly `http://localhost:3000`, not `127.0.0.1:3000`, so the state cookie host matches the registered callback host.
- Regression assertions set conflicting server and public URLs and verify that both server-fetch paths choose `API_URL`.

## Verification

Passed:

```text
pnpm --filter @klasr/web lint
pnpm --filter @klasr/web typecheck
pnpm --filter @klasr/web test
```

The web test suite passed 129 tests across 18 files. Lint retained two existing `react-hooks/exhaustive-deps` warnings in `app/dashboard/drive-workflow.tsx`.

No container build was run, as requested.
