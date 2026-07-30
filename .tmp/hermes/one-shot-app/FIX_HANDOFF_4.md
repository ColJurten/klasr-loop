# Fix Handoff 4

## Scope

- Fixed only the verified unhandled retry rejection from `CLAUDE_FINDINGS_4_VISUAL.md`.
- Preserved the existing parent-owned error/retry behavior, bulk partial-failure accounting, correction-dialog behavior, responsive layout, architecture, and dependency versions.
- Used `pnpm` only. Did not invoke Claude, npm, npx, subagents, profiles, commit, or push.

## Code Changes

- `apps/web/components/proposal-card.tsx`
  - Added `handleUserConfirm()` at the card click boundary.
  - It calls the existing async `handleConfirm()` and catches expected rejection from user-triggered confirm/retry/correction clicks.
  - `handleConfirm()` still awaits `onConfirm()` and only closes the correction dialog on success, so visible error state remains parent-owned.
  - Both the main `Valider`/`Réessayer` button and correction confirmation button now use the same click-boundary wrapper.

- `apps/web/tests/proposal-card.test.tsx`
  - Added focused regression test: `keeps recoverable retry failures inside the card click boundary`.
  - The test renders an error-state card, clicks `Réessayer`, verifies `onConfirm` receives the retry, asserts no `unhandledrejection` event, and confirms the retry UI/error copy remains visible with no `Classé` state.

## Evidence

- `pnpm --filter @klasr/web test -- proposal-card.test.tsx`
  - Passed.
  - Vitest reported `5 passed` test files and `22 passed` tests under the web project.

- `pnpm --filter @klasr/web lint`
  - Passed.
  - `next lint` reported no ESLint warnings or errors.

- `pnpm --filter @klasr/web typecheck`
  - Passed.
  - `tsc --noEmit` completed successfully.

- `pnpm --filter @klasr/web test`
  - Passed.
  - Vitest reported `5 passed` test files and `22 passed` tests.

- `pnpm --filter @klasr/web build`
  - Passed.
  - Next.js production build compiled successfully, generated static pages, and completed route optimization.
