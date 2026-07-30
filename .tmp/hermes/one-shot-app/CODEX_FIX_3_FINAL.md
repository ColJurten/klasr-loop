Fixed the verified `/demo` mobile overflow only.

Changed [demo-workspace.tsx](/root/projects/klasr-oneshot/klasr-loop/apps/web/app/demo/demo-workspace.tsx:130): added explicit mobile `grid-cols-1` and `min-w-0` on the two direct grid children, preserving the existing desktop `lg:grid-cols-[1fr_19rem]`.

Evidence written to [FIX_HANDOFF_3.md](/root/projects/klasr-oneshot/klasr-loop/.tmp/hermes/one-shot-app/FIX_HANDOFF_3.md:1).

Verification run with `pnpm`:
- `pnpm --filter @klasr/web run lint`: passed
- `pnpm --filter @klasr/web run typecheck`: passed
- `pnpm --filter @klasr/web run test`: 5 files, 21 tests passed
- `pnpm --filter @klasr/web run build`: passed
- Browser check at `390x844`: `scrollWidth: 390`, `innerWidth: 390`
- Browser check at `1440x900`: desktop grid remained `784px 304px`

No dependency versions changed, no Claude/subagent/profile invoked, no commit or push.