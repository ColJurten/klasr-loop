# Google challenge selection handoff

## Challenge strategy

- Automated user consent now applies one bounded strategy to every Google `/challenge/*` page reached after the initial password submission.
- `/challenge/pwd` re-enters the staging password at most once per run.
- `/challenge/selection` waits up to 3 seconds for visible button, link, radio, or label options. It selects a password option matching `passw` or `mot de passe`; when offered, it may open “Try another way” once before looking for that password option.
- A selection page without a password option fails visibly at `google-consent` and includes the option texts. Every other challenge type remains fail-visible. Captcha, recovery-code, and other challenge solving were not added.

## Guaranteed page copy

- Every failure escaping `loginWithGoogleUser` is wrapped at the shared Google-consent boundary with `PAGE_TEXT=<visible body copy>` first in the error detail.
- Body whitespace is collapsed and copy is limited to 300 characters; an empty or unreadable body produces `PAGE_TEXT=<no body text>`.
- Attempt 24 lost the old body copy because it was appended after the URL and heading, then truncated by the global 500-character failure sanitizer. Putting the bounded copy first guarantees it survives sanitization, including unexpected Playwright failures that bypass explicit challenge checks.

## Scope and verification

- Service-account behavior, consent actions, and failure-stage names are unchanged.
- `node --check scripts/live-google-service-account.mjs` — PASS
- `env -u KLASR_AUTH_MODE -u KLASR_MANUAL_CONSENT node scripts/live-google-service-account.mjs --auth-mode-check` — PASS
- `node --test scripts/agent/test/live-google-evidence.test.mjs` — PASS (35/35)
- `git diff --check` — PASS
- No live Google run or UI visual verification was performed, as required.
- Product/REAC mapping: harness reliability and test coverage support C4/C7; Drive data handling is untouched, so files continue to remain in Drive.
