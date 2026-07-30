# Visual Verification Finding 4 — BLOCKED

## Finding 4 — MEDIUM: expected demo retry emits an unhandled page error

Playwright evidence on `/demo`:

1. Click `Valider` on `proposal-prop_demo_retry`.
2. The intended UI error state appears and `Réessayer` is rendered.
3. Browser `pageerror` simultaneously receives `confirm failed`.

Root cause scope:

- `ProposalQueue.handleConfirm()` correctly records `error` and rethrows so bulk confirmation can count failures.
- `ProposalCard` invokes its async `handleConfirm()` with `void` from click handlers but does not catch the rejection, producing an unhandled browser error for the expected recoverable retry path.

Required fix:

- Fix only this unhandled rejection while preserving the visible error state, retry action, bulk partial-failure accounting, and correction-dialog behavior.
- Add/update a focused Vitest assertion proving a recoverable confirmation failure does not escape as an unhandled rejection while the retry UI remains available.
- Use pnpm only; do not invoke Claude, npm, npx, profiles, or subagents. Do not commit/push.
- Run focused web tests, lint, typecheck, and build. Record evidence in `.tmp/hermes/one-shot-app/FIX_HANDOFF_4.md`.
