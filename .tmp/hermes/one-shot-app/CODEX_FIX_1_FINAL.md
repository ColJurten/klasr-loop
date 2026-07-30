Fixed the verified round-1 findings only.

Changed:
- Pinned the five drifted direct dependencies in [apps/api/package.json](/root/projects/klasr-oneshot/klasr-loop/apps/api/package.json) and [apps/web/package.json](/root/projects/klasr-oneshot/klasr-loop/apps/web/package.json).
- Regenerated [pnpm-lock.yaml](/root/projects/klasr-oneshot/klasr-loop/pnpm-lock.yaml) with pnpm `10.15.1`.
- Corrected unsupported review claims in [.tmp/hermes/one-shot-app/BUILD_HANDOFF.md](/root/projects/klasr-oneshot/klasr-loop/.tmp/hermes/one-shot-app/BUILD_HANDOFF.md) and [.tmp/hermes/one-shot-app/CODEX_FINAL.md](/root/projects/klasr-oneshot/klasr-loop/.tmp/hermes/one-shot-app/CODEX_FINAL.md).
- Wrote evidence to [.tmp/hermes/one-shot-app/FIX_HANDOFF_1.md](/root/projects/klasr-oneshot/klasr-loop/.tmp/hermes/one-shot-app/FIX_HANDOFF_1.md).

Verification:
- Independent comparison of every direct dependency in `apps/api`, `apps/web`, and `scripts/agent` against the prior npm locks: all matched.
- `pnpm install`: passed.
- `pnpm lint`: passed.
- `pnpm typecheck`: passed.
- `pnpm test`: passed, API 31 / web 21 / agent 50.
- `pnpm build`: passed.

I did not invoke Claude, subagents, profiles, npm, or npx, and did not commit or push.