# Claude Sonnet Review Round 2 — BLOCKED

Reviewer model: `claude-sonnet-5`
Reviewer edited files: `false`
Reviewer session: `7db174ee-b8b5-497e-97c5-5ae7d5658260`

Round-1 dependency and handoff blockers are verified fixed.

## Finding 1 — HIGH: locked fonts are declared but not loaded

Evidence:

- `apps/web/app/layout.tsx` removed the former external Google Fonts links.
- Tailwind still declares Inter and JetBrains Mono, but there is no `next/font`, `@font-face`, local font asset, or font package.
- Browsers therefore fall back to system fonts, violating the locked Inter 400/500 and JetBrains Mono requirement.

Required fix:

- Self-host Inter 400/500 and JetBrains Mono 400/500 as local WOFF2 assets and load them through `next/font/local` (or an equivalent build-bundled, runtime-self-contained mechanism).
- Do not restore a runtime CDN dependency.
- Do not add a new package/runtime/framework or change existing dependency versions.
- Wire the loaded font variables into Tailwind/body so UI and mono paths actually render the required fonts.
- Include font license files/attribution if required by the upstream licenses.

## Finding 2 — MEDIUM: small normal text uses sub-AA contrast

Verified affected examples include:

- `apps/web/app/demo/demo-workspace.tsx`: `text-ink/45`, `text-ink/50`, `text-ink/55` on small text.
- `apps/web/components/proposal-card.tsx`: `text-ink/50`, `text-ink/55` on filenames/source/help/close controls.
- `apps/web/app/dashboard/layout.tsx`: `text-ink/40` chevron and `text-ink/50` small role text.

Required fix:

- In the affected Klasr screens/components, raise all normal small text/icon opacity below AA to `text-ink/60` or darker against paper/white.
- Keep the functional palette unchanged.
- Add or update focused tests if practical, then run all required pnpm checks.
- Record the contrast calculation/verification in the fix handoff.

## Scope guard

Fix only these font-loading and contrast findings. Do not refactor unrelated product behavior, add runtime dependencies, alter architecture, invoke Claude, commit, or push. Use pnpm only; never npm/npx.
