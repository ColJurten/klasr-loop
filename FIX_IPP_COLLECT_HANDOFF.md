# Google IPP recovery-phone confirmation handoff

## Change

- The verification-code path now detects `/challenge/ipp/collect`, `input#phoneNumberId`, or a sole unmarked telephone input as a recovery-phone confirmation step.
- That step waits for and clicks the single visible button whose trimmed text is exactly `Send`, then waits up to ten seconds for an explicit OTP input before allowing the existing relay to start. Missing or ambiguous `Send` actions and missing OTP inputs fail visibly through the existing redacted `PAGE_TEXT` wrapper.
- The OTP detector explicitly excludes `#phoneNumberId` and accepts only one-time-code autocomplete, `idvPin`, six/eight-digit telephone inputs, or one-character OTP groups.
- Relay parsing, deletion, redaction, deadline, retry-once behavior, guards, debug dumping, and the service-account path are unchanged.

## Verification

- `node --check scripts/live-google-service-account.mjs` — PASS
- `node --check scripts/agent/test/live-google-evidence.test.mjs` — PASS
- `env -u KLASR_AUTH_MODE -u KLASR_MANUAL_CONSENT -u KLASR_OAUTH_DEBUG_DUMP node scripts/live-google-service-account.mjs --auth-mode-check` — PASS
- `node scripts/live-google-service-account.mjs --oauth-code-relay-check` — PASS, including the IPP stub and `phoneNumberId` exclusion
- `node --test scripts/agent/test/live-google-evidence.test.mjs` — PASS (35/35)
- `git diff --check` — PASS
- No live Google run was performed.

## Scope notes

- Codex mode: direct workspace implementation.
- Changed files: `scripts/live-google-service-account.mjs`, `scripts/agent/test/live-google-evidence.test.mjs`, `FIX_IPP_COLLECT_HANDOFF.md`.
- Product invariants: unchanged; this affects only the user-auth Google challenge harness and does not alter the Drive data path.
- Design system / visual verification: not applicable; no application UI changed.
- REAC mapping: C8 (test and harness implementation) and C10 (fail-closed, redacted authentication handling).
- Known compromises: Google DOM behavior is covered by a stub; no live Google run was requested or performed.
