# Live Google guard-suite handoff

- Updated `scripts/agent/test/live-google-evidence.test.mjs` to pin the ported environment-LLM contract.
- Guards now require `genuineManualReview`, the current `llm_classification` and mutation manifest keys, the `env-llm-verified` observed schema, and the current failure-stage list.
- Guards explicitly reject removed `no_destination_match`, `tenant_setting_absent`, `anthropic-server-setup`, and `settings-delete` contracts.
- No product code or credentialed live run was touched.

Verification:

- `node --test scripts/agent/test/live-google-evidence.test.mjs` — 34/34 passed.
- `node scripts/live-google-service-account.mjs --decision-selection-check` — PASS.
- `node scripts/live-google-service-account.mjs --borrowed-carrier-check` — PASS.
- `node scripts/live-google-service-account.mjs --lifecycle-check` — PASS.
- `node --test scripts/agent/test/*.test.mjs` — 161/161 passed.
- `pnpm --filter @klasr/agent-orchestration test` was unavailable because `pnpm` is not installed.
