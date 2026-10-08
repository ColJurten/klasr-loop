# Manual Google consent harness handoff

## Mode semantics

- `KLASR_MANUAL_CONSENT` accepts only `true` or `false` and defaults to `false`.
- `KLASR_MANUAL_CONSENT=true` is valid only with `KLASR_AUTH_MODE=user`; combining it with service-account mode fails as a configuration error.
- User auto mode and the service-account path are unchanged. Manual user mode does not require, read, or type `KLASR_STAGING_ACCOUNT_PASSWORD`.
- The existing exact dashboard identity assertion against `KLASR_STAGING_ACCOUNT_EMAIL` remains in force before the tenant and mutation pipeline proceeds.

## Polling and timeout

- After clicking `Continuer avec Google` and reaching `accounts.google.com`, the harness prints `MANUAL_CONSENT_WAITING_URL=<full URL>` and leaves all Google sign-in, consent, 2FA, and captcha interaction to the human in the same headed browser.
- It polls the browser URL every 3 seconds. Reaching `/dashboard/` resumes the normal identity assertion, tenant reset, LLM configuration, fixture, mutation, and cleanup pipeline.
- `KLASR_MANUAL_CONSENT_TIMEOUT` is a positive integer in milliseconds and defaults to `2400000` (40 minutes).

## Failure paths

- Timeout fails at `google-consent` with `manual consent timed out after Ns`, the current URL, and the visible heading.
- Google `/signin/rejected`, `/signin/oauth/error`, and `/challenge/` URLs fail immediately at `google-consent` with the page URL and visible heading.
- No credential bypass, retry backoff, captcha solver, or automated interaction was added.

## Verification

- `node --check scripts/live-google-service-account.mjs` — PASS
- `env -u KLASR_AUTH_MODE -u KLASR_MANUAL_CONSENT node scripts/live-google-service-account.mjs --auth-mode-check` — PASS, including invalid manual-consent parsing and the user-only configuration assertion
- `git diff --check` — PASS

No live Google run was performed.
