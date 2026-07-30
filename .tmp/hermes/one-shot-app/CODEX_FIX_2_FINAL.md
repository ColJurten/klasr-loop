Implemented the round-2 fixes and wrote the evidence handoff at `.tmp/hermes/one-shot-app/FIX_HANDOFF_2.md`.

What changed:
- Added local WOFF2 assets and license/attribution files under `apps/web/app/fonts/`.
- Wired Inter 400/500 and JetBrains Mono 400/500 through `next/font/local` in `apps/web/app/layout.tsx`.
- Updated Tailwind font families to use the local font CSS variables.
- Raised affected low-contrast `text-ink/30-55` text/icon usages to `text-ink/60`.
- Verified no runtime Google Fonts/CDN references remain and no below-AA `text-ink/30-55` usages remain in `apps/web/app` or `apps/web/components`.

Checks passed:
- `pnpm --filter @klasr/web test -- proposal-card proposal-queue dashboard-session login-form sign-out-button`
- `pnpm --filter @klasr/web typecheck`
- `pnpm lint`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`

No Claude/subagent invocation, no npm/npx, no commit, no push.