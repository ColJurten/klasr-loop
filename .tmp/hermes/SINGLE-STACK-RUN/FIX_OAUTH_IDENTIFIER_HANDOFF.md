# Google OAuth identifier-page harness handoff

## Detection before

- `account-choice` ran the security-check scan before trying either the account chooser or the identifier form.
- The scan searched broad page text for `challenge`, `vérif`, and other generic phrases, so Google's normal `Sign in` identifier page could be classified as an unexpected security check.
- Chooser, identifier, and password detection used `locator.isVisible({ timeout })`; Playwright does not use that as a settling wait, so the fallback could inspect the v3 DOM too early.

## Detection after

- The user-mode flow waits up to 2 seconds for a staging-email account row (`[role="link"], button`) and then falls through without failure.
- It recognizes `/v3/signin/identifier`, `/signin/v2/identifier`, and `/signin/oauth/identifier`, and waits up to 15 seconds for `input[type="email"], input[name="identifier"]` on the fallback path.
- It fills `KLASR_STAGING_ACCOUNT_EMAIL`, clicks `#identifierNext`, waits for `input[type="password"]`, fills the environment-sourced password, and clicks `#passwordNext`.
- Consent continues through buttons named `Continue`, `Allow`, `Continuer`, or `Autoriser`.
- `Sign in` is not a challenge marker. Challenge failure is limited to an absent identifier field plus a captcha (`#captcha` or a reCAPTCHA iframe), `/challenge/` Google URLs, the requested suspicious/unusual/security phrases, or Google's insecure-browser message.
- Post-password `/signin/challenge/` and `/v3/signin/challenge` pages (including `Confirm it's you`/rescue flows) fail at `google-consent` with the sub-stage, URL, visible heading, and at most 1,200 characters of visible page text. The harness does not attempt to solve them.

## Sub-stage ordering

1. `account-choice`: short chooser wait.
2. `identifier`: settled identifier-field fallback and next action.
3. `password`: settled password field, next action, then genuine challenge check.
4. `consent-screen`: genuine challenge check followed by bounded consent-button waits.

The service-account path is unchanged. No credentials are embedded in the repository, and no live Google run was performed.

## Verification

- `node --check scripts/live-google-service-account.mjs` — PASS
- `env -u KLASR_AUTH_MODE node scripts/live-google-service-account.mjs --auth-mode-check` — PASS
- `git diff --check` — PASS
