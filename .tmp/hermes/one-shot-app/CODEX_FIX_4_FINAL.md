Fixed the verified unhandled retry rejection only.

Changed:
- [proposal-card.tsx](/root/projects/klasr-oneshot/klasr-loop/apps/web/components/proposal-card.tsx:51): added a card-level click wrapper that catches expected confirmation/retry rejection while leaving parent-owned error state and bulk accounting intact.
- [proposal-card.test.tsx](/root/projects/klasr-oneshot/klasr-loop/apps/web/tests/proposal-card.test.tsx:60): added a focused regression proving `Réessayer` rejection does not emit `unhandledrejection` and the retry UI remains visible.
- [FIX_HANDOFF_4.md](/root/projects/klasr-oneshot/klasr-loop/.tmp/hermes/one-shot-app/FIX_HANDOFF_4.md:1): wrote evidence and scope notes.

Verification passed with `pnpm`:
- `pnpm --filter @klasr/web test -- proposal-card.test.tsx`
- `pnpm --filter @klasr/web lint`
- `pnpm --filter @klasr/web typecheck`
- `pnpm --filter @klasr/web test`
- `pnpm --filter @klasr/web build`

No commit or push was made.