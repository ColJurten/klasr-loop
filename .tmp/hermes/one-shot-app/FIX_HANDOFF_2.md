# Fix Handoff 2

## Fixed Findings

### Finding 1: locked fonts declared but not loaded

Fix:

- Added local WOFF2 assets under `apps/web/app/fonts/`:
  - `Inter-Regular.woff2`
  - `Inter-Medium.woff2`
  - `JetBrainsMono-Regular.woff2`
  - `JetBrainsMono-Medium.woff2`
- Loaded the local assets with `next/font/local` in `apps/web/app/layout.tsx`.
- Applied the generated CSS variables on `<body>`:
  - `--font-inter`
  - `--font-jetbrains-mono`
- Updated Tailwind font families in `apps/web/tailwind.config.ts` so:
  - `font-sans` resolves through `var(--font-inter)`
  - `font-mono` resolves through `var(--font-jetbrains-mono)`
- Did not add a package, change dependency versions, or restore any runtime font CDN.

Source and license:

- Inter source: Inter 4.1 release, `https://github.com/rsms/inter/releases/tag/v4.1`
  - Upstream archive member files: `web/Inter-Regular.woff2`, `web/Inter-Medium.woff2`
  - License included at `apps/web/app/fonts/Inter-LICENSE.txt`
- JetBrains Mono source: JetBrains Mono 2.304 release, `https://github.com/JetBrains/JetBrainsMono/releases/tag/v2.304`
  - Upstream archive member files: `fonts/webfonts/JetBrainsMono-Regular.woff2`, `fonts/webfonts/JetBrainsMono-Medium.woff2`
  - License included at `apps/web/app/fonts/JetBrainsMono-OFL.txt`
  - Authors included at `apps/web/app/fonts/JetBrainsMono-AUTHORS.txt`
- Repository attribution added at `apps/web/app/fonts/ATTRIBUTION.md`.

Asset hashes:

```text
0ff3e94614e1493eb556314fd247ae6c4a85a7783b4cc86be539940cf83f2a48  apps/web/app/fonts/Inter-Medium.woff2
e06f6b1bc553aaea4e4668023ed0ab0a147129c3107f511bc7d03d361b0ae085  apps/web/app/fonts/Inter-Regular.woff2
086c48dfbea9ddaff1320f7e09399b8e2924e88ce67453721255db3bdbb5a353  apps/web/app/fonts/JetBrainsMono-Medium.woff2
a9cb1cd82332b23a47e3a1239d25d13c86d16c4220695e34b243effa999f45f2  apps/web/app/fonts/JetBrainsMono-Regular.woff2
262481e844521b326f5ecd053e59b98c8b2da78c8ee1bdbb6e8174305e54935a  apps/web/app/fonts/Inter-LICENSE.txt
33f99c94ef0a0909d7584a5d4bde1fb9b1630daa620f5a788c28c43327e79412  apps/web/app/fonts/JetBrainsMono-AUTHORS.txt
30f0c136e3c88e422d0791acd97238870f9054a9729bc34cf2ff0d4ed8cac4ad  apps/web/app/fonts/JetBrainsMono-OFL.txt
1f1bca6b8296ff369fd9a421d4dfa0a7fb67cba48b77a198eaffd2a83f9fa786  apps/web/app/fonts/ATTRIBUTION.md
```

Static evidence:

```text
apps/web/app/layout.tsx imports next/font/local.
apps/web/app/layout.tsx references ./fonts/Inter-Regular.woff2, ./fonts/Inter-Medium.woff2,
./fonts/JetBrainsMono-Regular.woff2, and ./fonts/JetBrainsMono-Medium.woff2.
apps/web/tailwind.config.ts maps font-sans to var(--font-inter).
apps/web/tailwind.config.ts maps font-mono to var(--font-jetbrains-mono).
```

### Finding 2: small normal text uses sub-AA contrast

Fix:

- Raised all scanned `text-ink/30`, `text-ink/40`, `text-ink/45`, `text-ink/50`, and `text-ink/55` text/icon usages under `apps/web/app` and `apps/web/components` to `text-ink/60`.
- Preserved functional colors such as lavender, sage, peach, and border opacity tokens.

Affected files:

- `apps/web/app/demo/demo-workspace.tsx`
- `apps/web/components/proposal-card.tsx`
- `apps/web/app/dashboard/layout.tsx`
- `apps/web/app/dashboard/page.tsx`
- `apps/web/app/dashboard/proposal-queue.tsx`
- `apps/web/app/dashboard/sign-out-button.tsx`
- `apps/web/app/login/login-form.tsx`
- `apps/web/app/page.tsx`

Contrast evidence:

Calculated with WCAG relative luminance using `#0A0A0A` at 60% alpha composited over the actual backgrounds.

```text
text-ink/60 on white #FFFFFF: rgb(108, 108, 108), contrast 5.25:1
text-ink/60 on paper #FAFAF7: rgb(106, 106, 105), contrast 5.18:1
```

Both exceed WCAG AA 4.5:1 for normal text.

Static scan evidence:

```text
rg -n --glob '!apps/web/tsconfig.tsbuildinfo' "text-ink/(30|4[0-9]|5[0-9])" apps/web/app apps/web/components || true
```

Result: no matches.

## Check Evidence

Focused checks:

```text
pnpm --filter @klasr/web test -- proposal-card proposal-queue dashboard-session login-form sign-out-button
```

Result:

```text
Test Files  5 passed (5)
Tests  21 passed (21)
```

```text
pnpm --filter @klasr/web typecheck
```

Result: passed.

Required root checks:

```text
pnpm lint
```

Result:

```text
apps/web lint: ✔ No ESLint warnings or errors
apps/api lint: Done
```

```text
pnpm typecheck
```

Result:

```text
apps/web typecheck: Done
apps/api typecheck: Done
```

```text
pnpm test
```

Result:

```text
apps/api test: Test Suites: 7 passed, 7 total
apps/api test: Tests: 31 passed, 31 total
scripts/agent test: # pass 50
apps/web test: Test Files  5 passed (5)
apps/web test: Tests  21 passed (21)
```

```text
pnpm build
```

Result:

```text
apps/api build: Done
apps/web build: ✓ Compiled successfully
apps/web build: ✓ Generating static pages (7/7)
apps/web build: Done
```

## Scope Notes

- Used `pnpm` only for package scripts.
- Did not invoke Claude, subagents, npm, or npx.
- Did not commit or push.
- No new runtime package or CDN dependency was added.
