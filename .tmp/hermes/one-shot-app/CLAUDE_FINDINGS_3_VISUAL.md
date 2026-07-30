# Visual Verification Finding — BLOCKED

## Finding 3 — MEDIUM: `/demo` overflows horizontally on 390px mobile viewport

Playwright evidence:

- Viewport width: `390px`
- `document.documentElement.scrollWidth`: `405px`
- Main grid children begin at `x=20` and end at `x=405`, so content exceeds the viewport by `15px`.
- Evidence screenshot: `.tmp/hermes/one-shot-app/screenshots/demo-mobile-overflow.png`
- Diagnostic output identified the implicit mobile grid column/min-content sizing under `apps/web/app/demo/demo-workspace.tsx` as the containing cause; long mono paths contribute to the minimum width.

Required fix:

- Fix only the responsive `/demo` overflow without changing product behavior or desktop design.
- Use a zero-minimum-width mobile grid/children strategy (for example an explicit `grid-cols-1`/`min-w-0` arrangement) and preserve truncation/wrapping where intended.
- Verify at 390x844 that `scrollWidth <= innerWidth` and that desktop 1440px layout remains correct.
- Use pnpm only; do not invoke Claude, npm, npx, profiles, or subagents. Do not commit or push.
- Run focused web tests/typecheck/lint/build and record evidence in `.tmp/hermes/one-shot-app/FIX_HANDOFF_3.md`.
