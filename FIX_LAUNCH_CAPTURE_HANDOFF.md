# Launch-status capture handoff

- Harness-only change: `chooseBrowserItem` now scopes request, response, and console listeners to the launch click/status assertion.
- Launch-status failures record the redacted Playwright first line, launch request/response and timing, alerts, status count/text, last warning/error, and page URL in a single line capped at 1500 characters.
- Other assertion failures retain the existing three-line/500-character sanitization cap.

Verification passed:

```text
node scripts/live-google-service-account.mjs --decision-selection-check
node scripts/live-google-service-account.mjs --borrowed-carrier-check
node --test scripts/agent/test/live-google-evidence.test.mjs
```

The credentialed flow was not run.
