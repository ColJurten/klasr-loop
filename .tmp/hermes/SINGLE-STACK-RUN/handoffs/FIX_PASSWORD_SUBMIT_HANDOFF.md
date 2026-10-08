# Tolerant password submit handoff

- Converted both Google password actions: the initial credential submit and the `/challenge/pwd` password re-verification submit.
- Each action waits up to 6 seconds for visible `#passwordNext`, then falls back to `googleCodePrimaryAction(page)`: one non-excluded `button[type=submit]` first, then one non-excluded button matching `send|continuer|next|ok|weiter`. Existing call, phone, alternate-method, computer, and confirm exclusions are unchanged.
- If both actions fail, the original `#passwordNext` error escapes through the existing `googleConsentError` sanitizer with `PAGE_TEXT`. With `KLASR_OAUTH_DEBUG_DUMP=true`, it first emits the standard 1.5-second-settled URL and first 60 interactive elements.
- Extracted `emitOauthDebugDump` from the verification-code challenge path; password-submit failures and the existing challenge failure now share the same dump schema and redaction.
- Added auth-mode self-check coverage for a password page with only a `Suivant` submit button and for a page with no actionable controls.

Verification:

- `node --check scripts/live-google-service-account.mjs` — PASS
- `env -u KLASR_AUTH_MODE -u KLASR_MANUAL_CONSENT -u KLASR_OAUTH_DEBUG_DUMP node scripts/live-google-service-account.mjs --auth-mode-check` — PASS
- `node --test scripts/agent/test/live-google-evidence.test.mjs` — PASS (36/36)
- No live Google run was performed.
