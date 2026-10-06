# Builder fix round 3 handoff

## Changes

- B3: The source guard now requires the LLM setup call to exist and precede launch.
- Failure sanitization drops all `Received...` diagnostic lines.
- Non-JSON LLM settings errors retain the HTTP status and fallback message.
- Unsupported providers fail before any Google Drive mutation.
- The correction path waits for the folder picker before checking that LLM help is absent.

## Checks

- Removed the correction-path `await configureLlmThroughUi(page);` temporarily and ran only the guard test — FAIL with `Every reset must contain LLM setup before launch`; restored the call.
- `node --test scripts/agent/test/live-google-evidence.test.mjs` — PASS (34/34)
- `node scripts/live-google-service-account.mjs --decision-selection-check` — PASS
- `node scripts/live-google-service-account.mjs --borrowed-carrier-check` — PASS
- Credentialed live flow was not run.
