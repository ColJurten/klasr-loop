# Google password re-verification handoff

## Match rule

- Automated Google user consent recognizes only a URL path segment matching `/challenge/pwd`, including `/v3/signin/challenge/pwd` and `/challenge/pwd`, with an optional trailing slash or query string.
- After the initial password submission reaches that path, the harness waits for a visible password input, fills the same staging password, and submits with `#passwordNext` or falls back to `button[type="submit"]`.
- `Welcome` is not used as a security-challenge heading marker.

## Single-re-entry rule

- Password re-verification is attempted at most once.
- If its submission leaves the browser on `/challenge/pwd`, the run fails at `google-consent` with `substage=password` and reason `password re-verification staged again`.

## Remaining fail-visible types

- Every other `/challenge/*` variant, including `/challenge/reen`, `/challenge/ipp`, phone, and recovery-code flows, remains an unexpected security check.
- reCAPTCHA frames, rejected/error pages, suspicious or unusual-traffic text, and unknown pages remain fail-visible.
- Failures retain the URL, heading, and whitespace-normalized body copy bounded to 300 characters.
- Account chooser, identifier, consent interactions, manual-consent behavior, and the service-account path are unchanged.

## Verification

- `node --check scripts/live-google-service-account.mjs` — PASS
- `env -u KLASR_AUTH_MODE -u KLASR_MANUAL_CONSENT node scripts/live-google-service-account.mjs --auth-mode-check` — PASS
- `git diff --check` — PASS
- No live Google run performed
