# Google code-option DOM debug dump handoff

## Change

- Added fail-closed `KLASR_OAUTH_DEBUG_DUMP=true|false` parsing, defaulting to `false`.
- When the verification-code option reveals no OTP input and no unambiguous primary action, debug mode waits 1.5 seconds, re-reads the URL, and logs up to 60 interactive DOM elements between `OAUTH_DEBUG_DUMP_BEGIN` and `OAUTH_DEBUG_DUMP_END` before preserving the existing visible failure.
- The dump contains only the requested element metadata and bounded text; it never reads input values. The staging email, staging password, and email-shaped text are redacted from both the URL and element JSON.
- Relay behavior, challenge guards, and the service-account path are unchanged. No live Google run was performed.

## Verification

- `node --check scripts/live-google-service-account.mjs` — PASS
- `env -u KLASR_AUTH_MODE -u KLASR_MANUAL_CONSENT -u KLASR_OAUTH_DEBUG_DUMP node scripts/live-google-service-account.mjs --auth-mode-check` — PASS (default, true, and invalid flag cases)
- `node scripts/live-google-service-account.mjs --oauth-code-relay-check` — PASS (includes fake staging email/password redaction assertion)
- `node --test scripts/agent/test/live-google-evidence.test.mjs` — PASS (35/35)
- `git diff --check` — PASS

## Scope notes

- Codex mode: direct workspace implementation.
- Changed files: `scripts/live-google-service-account.mjs`, `FIX_DEBUG_DUMP_HANDOFF.md`.
- Product invariants: unchanged; the diagnostic reads DOM metadata only and does not alter the Drive data path.
- Design system / visual verification: not applicable; no application UI changed.
- REAC mapping: C8 (test and diagnostic instrumentation) and C10 (secure handling of diagnostic output).
- Known compromise: intentionally temporary, env-gated diagnostic instrumentation for one orchestrated Google run.
