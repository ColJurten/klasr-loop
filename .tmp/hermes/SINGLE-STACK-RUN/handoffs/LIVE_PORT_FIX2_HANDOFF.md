# Live port fix 2 handoff

## Result

- Replaced the unreachable `no_destination_match` contract with a DB-read proof that the configured-LLM proposal requires review, has no destination, and has a non-empty reason other than `extraction_failed`.
- The correction dialog must display the exact review reason read from that proposal.
- Real-provider provenance remains required as `${KLASR_LLM_PROVIDER}/${KLASR_LLM_MODEL}` before `llm_classification` can pass. No fixture uses `local` or `fake`.
- `selectedModelId` now accepts `:` and one embedded `/`, while retaining the 200-character limit.
- Removed the empty `anthropic-server-setup` stage, the unbound final settings assertion, and the unused `fixtureMode` argument.

## Credential-free verification

Passed:

```text
node --check scripts/live-google-service-account.mjs
node --check scripts/live-google-evidence.mjs
node scripts/live-google-service-account.mjs --decision-selection-check
node scripts/live-google-service-account.mjs --borrowed-carrier-check
KLASR_FATAL_CHECK_DIR=$(mktemp -d) node scripts/live-google-service-account.mjs --evidence-self-check
apps/api-py/.venv/bin/black --check scripts/live-google-db.py
apps/api-py/.venv/bin/flake8 scripts/live-google-db.py
```

The credentialed run was not executed.

## Deferred non-blockers

- `Job.created_at` remains DB-session-local. A one-line UTC conversion is not safe without fixing or reading the PostgreSQL session timezone; this diagnostic does not affect PASS/FAIL.
- Borrowed-carrier and BYOK self-check paths remain because repository tests explicitly exercise them. Removing them in isolation would break that matrix.
