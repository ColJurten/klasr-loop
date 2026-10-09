# Google OAuth recovery-code relay handoff

## Challenge option and input strategy

- Automated user consent now prefers a visible “Get a verification code” / “Envoyer un code” option on Google challenge-selection pages, then a call option, and preserves the existing password-option fallback.
- After selecting a code-producing option, the harness waits for the first visible input that is not a password or email field. A single input is filled at once; a visible group whose inputs all have `maxlength="1"` is filled digit by digit.
- The existing consent Continue/Allow loop and final dashboard identity assertion remain unchanged after Google leaves the challenge URL.

## Relay contract

- `KLASR_OAUTH_CODE_FILE` defaults to `.tmp/hermes/SINGLE-STACK-RUN/oauth-code.txt` and is constrained beneath the repository `.tmp` directory. `KLASR_OAUTH_CODE_TIMEOUT` defaults to `600000` ms and rejects non-positive or non-integer values.
- Both settings are evaluated only in user-auth mode. Service-account behavior is unchanged.
- For each permitted submission, stdout emits `OAUTH_CODE_WAITING_AT=<ISO timestamp>`, then polls every two seconds. Only stripped content matching exactly 4–10 digits is accepted; a valid file is deleted before its code is typed.
- The primary Google submit control is clicked. Remaining on a challenge URL permits one retry and a second relay marker. Both polls share the original deadline; timeout fails with `verification code relay timed out`, and a second rejection fails visibly at `google-consent` with PAGE_TEXT.

## Redaction and verification

- Google consent body text and error detail replace every 4–10 digit run with `[REDACTED]` before logging or failure persistence. The relay code itself is never logged.
- `node --check scripts/live-google-service-account.mjs` — PASS
- `env -u KLASR_AUTH_MODE -u KLASR_MANUAL_CONSENT node scripts/live-google-service-account.mjs --auth-mode-check` — PASS
- `node --test scripts/agent/test/live-google-evidence.test.mjs` — PASS (35/35)
- `git diff --check` — PASS
- No live Google run was performed.
