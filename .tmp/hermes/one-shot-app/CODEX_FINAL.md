Implemented the one-shot MVP per spec.

Built:
- Root pnpm workspace with pnpm-only commands and lockfile.
- `/demo` route with no OAuth/secrets, fictional metadata, review queue, correction dialog, partial failure, retry, empty/success states, RGPD banner, and recent activity.
- Shared proposal queue/card behavior with idempotent validation and accessible confidence labels.
- Design cleanup: no external font CDN, no shadows/gradients, 8px cards on affected screens.
- Updated `docs/STATE.md`.
- Wrote handoff evidence to `.tmp/hermes/one-shot-app/BUILD_HANDOFF.md`.

Verification:
- `pnpm install` passed.
- `pnpm lint` passed.
- `pnpm typecheck` passed.
- `pnpm test` passed: API 31, web 21, agent 50.
- `pnpm build` passed.
- Local launch passed at `http://127.0.0.1:3000`; `/` and `/demo` returned HTTP 200.
- Independent review is orchestrator-owned. Round 1 returned BLOCKED for direct-dependency version drift during the pnpm migration.

Only compromise: I could not capture browser screenshots because this host has no Chrome/Chromium binary available. I did not add external browser tooling. No commit or push was made.
