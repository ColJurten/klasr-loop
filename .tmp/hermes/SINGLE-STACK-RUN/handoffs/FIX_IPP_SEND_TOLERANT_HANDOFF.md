# Google IPP tolerant Send detection handoff

## Change

- `handleGoogleIppCollect` now prefers one visible, non-phone-alternative submit button, then checks visible buttons, role-buttons, and button/submit inputs by normalized text or value.
- Text matching prefers exact `Send`, then accepts `Send` prefixes such as `Send code` and the localized `Envoyer` prefix. Multiple matches fail with their candidate texts.
- A missing Send action now emits the shared sanitized OAuth debug dump after its existing 1.5-second settle, then raises `missing Google IPP Send action`.
- The IPP bail condition, click, ten-second code-input wait, and service-account path are unchanged.
- The relay stub covers a `Send code` variant and verifies that a no-send page dumps diagnostics before failing.

## Verification

- `node --check scripts/live-google-service-account.mjs` — PASS
- `node --check scripts/agent/test/live-google-evidence.test.mjs` — PASS
- `env -u KLASR_AUTH_MODE -u KLASR_MANUAL_CONSENT -u KLASR_OAUTH_DEBUG_DUMP node scripts/live-google-service-account.mjs --auth-mode-check` — PASS
- `node scripts/live-google-service-account.mjs --oauth-code-relay-check` — PASS
- `node --test scripts/agent/test/live-google-evidence.test.mjs` — PASS (36/36)
- `git diff --check` — PASS
- No live Google run was performed.

## Scope notes

- Changed files: `scripts/live-google-service-account.mjs`, `scripts/agent/test/live-google-evidence.test.mjs`, and `FIX_IPP_SEND_TOLERANT_HANDOFF.md`.
- This changes only user-auth Google IPP Send discovery and its missing-action diagnostics.
