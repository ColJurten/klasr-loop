# Live Google publisher seam handoff

- Aligned the publisher's result allowlist with the runner's exact 13-key manifest schema.
- The guard suite now uses one result-key constant and compares the publisher allowlist directly with the runner's `assertManifest` schema string.
- Commit a684bba changed `KLASR_LIVE_FIXTURE_MODE` to default to `runner-owned`; `borrowed-carrier` can no longer produce PASS evidence.
- Renamed the environment-key guard to describe its actual no-newline validation; configured-LLM provenance remains enforced by `modelUsed` equality.
- No credentialed run or product code was touched.

Verification:

- `node --check scripts/publish-live-google-status.mjs` — PASS.
- `node --check scripts/agent/test/live-google-evidence.test.mjs` — PASS.
- `node --test scripts/agent/test/live-google-evidence.test.mjs` — 34/34 passed.
- `node scripts/live-google-service-account.mjs --decision-selection-check` — PASS.
- `node scripts/live-google-service-account.mjs --borrowed-carrier-check` — PASS.
- `node scripts/live-google-service-account.mjs --lifecycle-check` — PASS.
