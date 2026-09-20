# Live Google harness integrity fix

The live acceptance path is now unambiguous: use runner-owned fixtures so one
run performs OCR, review, confirm, ignore, correction, provider read-back, and
the content-free mutation audit. Borrowed-carrier mode cannot emit a PASS
manifest because it does not exercise that full path.

## Reviewer invocation

Use the existing Python 3.13+ `apps/api-py/.venv` (the current venv is 3.14).
Install repository dependencies and ensure `pnpm` is on `PATH` for the command:

```bash
KLASR_GOOGLE_SERVICE_ACCOUNT_FILE=/absolute/path/service-account.json \
KLASR_GOOGLE_DRIVE_ROOT_ID=... \
KLASR_LLM_PROVIDER=... \
KLASR_LLM_MODEL=... \
KLASR_LLM_API_KEY=... \
KLASR_LLM_BASE_URL=... \
KLASR_EVIDENCE_SHA="$(git rev-parse HEAD)" \
KLASR_EVIDENCE_ISSUE=5 \
KLASR_EVIDENCE_ATTEMPT=... \
KLASR_EVIDENCE_TASK=t_... \
KLASR_LIVE_FIXTURE_MODE=runner-owned \
pnpm test:live-google-sa
```

`KLASR_LLM_BASE_URL` is optional for native providers. The runner starts Next.js
through its installed binary, so app startup does not shell out to `pnpm`.
Never commit credentials, Drive IDs, or file content. Full-page screenshots can
show Drive names; keep every fixture and folder name synthetic and non-sensitive.

## Local verification

No credentialed run was started. These credential-free checks pass:

- `node --check` for both touched `.mjs` files
- decision-selection, borrowed-carrier, lifecycle, quota-mode, env-LLM,
  evidence-schema, and provider-identity self-checks
- Black and Flake8 for `live-google-db.py` and `live-google-api.py`
