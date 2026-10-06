# Google IPP dispatch-race handoff

## Change

- After selecting the verification-code option, the harness now waits up to eight seconds for Google to leave `/challenge/selection` before dispatching the IPP handler. The wait remains timeout-tolerant so the existing visible failure path is preserved.
- `handleGoogleIppCollect` now gives `#phoneNumberId` or a visible telephone input up to two seconds to render before evaluating its unchanged IPP bail condition.
- The relay, redaction, retry-once behavior, guards, service-account path, and all other authentication behavior are unchanged.
- A delayed stub reproduces navigation and DOM rendering after the code-option click, and verifies that IPP handling succeeds and clicks `Send`.

## Verification

- `node --check scripts/live-google-service-account.mjs` — PASS
- `node --check scripts/agent/test/live-google-evidence.test.mjs` — PASS
- `env -u KLASR_AUTH_MODE -u KLASR_MANUAL_CONSENT -u KLASR_OAUTH_DEBUG_DUMP node scripts/live-google-service-account.mjs --auth-mode-check` — PASS
- `node scripts/live-google-service-account.mjs --oauth-code-relay-check` — PASS
- `node --test scripts/agent/test/live-google-evidence.test.mjs` — PASS (36/36)
- `git diff --check` — PASS
- No live Google run was performed.

## Scope notes

- Changed files: `scripts/live-google-service-account.mjs`, `scripts/agent/test/live-google-evidence.test.mjs`, and `FIX_IPP_RACE_HANDOFF.md`.
- Product invariants are unchanged; this affects only timing in the user-auth Google challenge harness.
- The regression uses a stub because no live Google run was requested.
