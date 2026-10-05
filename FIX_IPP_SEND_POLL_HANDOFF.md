# Google IPP late-render Send polling handoff

## Change

- `handleGoogleIppCollect` now re-queries visible Send candidates every 500 ms for up to 10 seconds, preserving the existing submit, exact `Send`, and Send-prefix preference order and exclusions.
- A single candidate is clicked immediately; multiple candidates fail visibly with their texts, while a timeout emits the existing sanitized OAuth debug dump before raising `missing Google IPP Send action`.
- The post-click code-input wait and service-account path are unchanged.
- The relay stub delays only the Send button by a simulated two seconds and verifies polling reaches it; the never-appears diagnostic case remains covered.

## Verification

- `node --check scripts/live-google-service-account.mjs` — PASS
- `node --check scripts/agent/test/live-google-evidence.test.mjs` — PASS
- `env -u KLASR_AUTH_MODE -u KLASR_MANUAL_CONSENT -u KLASR_OAUTH_DEBUG_DUMP node scripts/live-google-service-account.mjs --auth-mode-check` — PASS
- `node scripts/live-google-service-account.mjs --oauth-code-relay-check` — PASS
- `node --test scripts/agent/test/live-google-evidence.test.mjs` — PASS (36/36)
- `git diff --check` — PASS
- No live Google run was performed.
