# Google IPP bounding-box Send polling handoff

## Change

- `handleGoogleIppCollect` now enumerates plain button, role-button, and button/submit input selectors, then keeps only candidates with a non-null, positive-size bounding box.
- The existing submit, exact `Send`, and Send-prefix priority, exclusions, ambiguity handling, normal Playwright click, relay flow, and service-account path are unchanged.
- The Send poll now runs every 500 ms for up to 20 seconds.
- The relay stub returns a null Send bounding box for three scans before exposing a real box and verifies that the handler clicks `Send`.

## Verification

- `node --check scripts/live-google-service-account.mjs` — PASS
- `node --check scripts/agent/test/live-google-evidence.test.mjs` — PASS
- `env -u KLASR_AUTH_MODE -u KLASR_MANUAL_CONSENT -u KLASR_OAUTH_DEBUG_DUMP node scripts/live-google-service-account.mjs --auth-mode-check` — PASS
- `node scripts/live-google-service-account.mjs --oauth-code-relay-check` — PASS
- `node --test scripts/agent/test/live-google-evidence.test.mjs` — PASS (37/37)
- `git diff --check` — PASS
- No live Google run was performed.

## Scope

- Changed files: `scripts/live-google-service-account.mjs`, `scripts/agent/test/live-google-evidence.test.mjs`, and `FIX_IPP_BBOX_HANDOFF.md`.
- This changes only user-auth Google IPP Send discovery and its polling window.
