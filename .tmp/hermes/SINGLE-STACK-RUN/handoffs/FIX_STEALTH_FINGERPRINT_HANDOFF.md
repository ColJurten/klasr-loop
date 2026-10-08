# Google sign-in fingerprint handoff

## Browser fingerprint

- The headed acceptance browser launches with `--disable-blink-features=AutomationControlled`, `--no-sandbox`, `--lang=en-US,en`, and `--disable-infobars`.
- Its existing `1280x1000` viewport is unchanged; the context locale is `en-US`.
- Before any page is created, the context init script deletes `webdriver` from the navigator prototype, preserves an existing `window.chrome` or supplies `{ runtime: {} }`, exposes `['en-US', 'en']` as `navigator.languages`, and exposes `[1, 2, 3, 4, 5]` as `navigator.plugins`.
- A headed local sanity launch reported `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36`. It contains no `Headless` token, so the harness does not override the real bundled-Chromium user agent.

## Rejected-page capture

- Automated and manual user flows recognize `/signin/rejected`, `/signin/oauth/error`, and `/challenge/` URLs as Google error/challenge pages.
- Google-consent failures use `body copy=<text>` after replacing all whitespace runs (including newlines) with one space, trimming, and limiting the result to 300 characters. The existing substage, reason, URL, and heading fields remain present.
- The service-account branch, consent interactions, assertions, and manual-consent mode remain unchanged. Automated user mode remains the default when `KLASR_MANUAL_CONSENT=false`.

## Verification

- `node --check scripts/live-google-service-account.mjs` — PASS
- `env -u KLASR_AUTH_MODE -u KLASR_MANUAL_CONSENT node scripts/live-google-service-account.mjs --auth-mode-check` — PASS
- Headed local Chromium UA print only — PASS; no live Google run
- `git diff --check` — PASS
