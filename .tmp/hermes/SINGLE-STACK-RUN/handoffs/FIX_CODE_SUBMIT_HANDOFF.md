# Google verification-code option submit handoff

## Change

- The user-auth verification-code path now clicks the preferred code option and polls for an explicit visible OTP input for three seconds.
- If the row click only selects a radio, the harness clicks exactly one eligible primary action, preferring `button[type="submit"]` and otherwise matching Send/Continuer/Next/OK/Weiter. Call, phone, alternate-method, computer, and confirm actions are excluded; missing or ambiguous actions fail with the existing redacted `PAGE_TEXT` context.
- After primary submission, the harness waits eight seconds for the OTP input. One new verification-code selection page may be handled again; a second re-selection fails visibly.
- `OAUTH_CODE_WAITING_AT` and relay-file polling begin only after the code input is visible. Existing relay parsing, deletion, redaction, shared deadline, retry, and timeout behavior are unchanged. The service-account path is unchanged.

## Verification

- `node --check scripts/live-google-service-account.mjs` — PASS
- `env -u KLASR_AUTH_MODE -u KLASR_MANUAL_CONSENT node scripts/live-google-service-account.mjs --auth-mode-check` — PASS
- `node scripts/live-google-service-account.mjs --oauth-code-relay-check` — PASS (radio/submit stub, exclusion, and ambiguity checks)
- `node --test scripts/agent/test/live-google-evidence.test.mjs` — PASS (35/35)
- `git diff --check` — PASS
- No live Google run was performed.
