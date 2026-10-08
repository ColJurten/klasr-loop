# Builder fix round 2 handoff

## Findings

- B1: Kept the `Choisir ce dossier` render wait and replaced the premature launch-button assertion with `#llm-launch-help` absence (`scripts/live-google-service-account.mjs:354-357`). The post-selection enabled assertion remains in `chooseBrowserItem` (`:1025`).
- B2: Extracted authenticated UI setup into `configureLlmThroughUi` (`:1002-1018`) and call it after both tenant resets (`:350-353`, `:518-522`). Both paths verify that `#llm-launch-help` is absent.
- B3: Added a runtime reset/configure/launch contract (`:17-21`, `:243`, `:604-611`, `:1000`, `:1017`, `:1025`). The guard test executes the contract and checks that every reset is followed by UI setup before the next launch (`scripts/agent/test/live-google-evidence.test.mjs:239-253`).
- M1: Failure sanitization now redacts `ya29.*`, the access token, and the resolved internal, NextAuth, and token-encryption secrets (`scripts/live-google-service-account.mjs:596-602`).
- M2/M3: Failure details drop `Received:` lines, retain at most three lines/500 characters, and collapse whitespace to one log line (`:599-602`).
- L1: The settings response wait and submit click now run in one `Promise.all` (`:1009-1012`).
- L2: Failed settings saves report HTTP status and API `error`; normal failure sanitization redacts the result (`:1013-1015`).
- L3: Unsupported providers fail before the Anthropic radio is used (`:1003`).
- L4: Removed the redundant dashboard reload; navigation proceeds directly to the folder-picker render wait (`:354-357`).
- Optional: API, worker, and web child environments no longer inherit `KLASR_LLM_PROVIDER`, `KLASR_LLM_MODEL`, or `KLASR_LLM_API_KEY` (`:940-950`).

## Checks

- `node scripts/live-google-service-account.mjs --decision-selection-check` — PASS
- `node scripts/live-google-service-account.mjs --borrowed-carrier-check` — PASS
- `node --test scripts/agent/test/live-google-evidence.test.mjs` — PASS (34/34)
- Credentialed live flow was not run.
