# Fix Handoff 3

## Scope

Fixed only the verified mobile overflow finding from `.tmp/hermes/one-shot-app/CLAUDE_FINDINGS_3_VISUAL.md`.

Changed:
- `apps/web/app/demo/demo-workspace.tsx`

Responsive layout change:
- `/demo` `<main>` now has explicit `grid-cols-1` below `lg`.
- The two direct grid children now have `min-w-0`.
- Existing desktop `lg:grid-cols-[1fr_19rem]` is preserved.
- No dependency files changed.
- No product logic changed.
- No commit or push performed.
- Did not invoke Claude, npm, npx, subagents, or profiles.

## Browser Evidence

Server used for browser verification:
- `pnpm --dir apps/web exec next start -p 3013`
- URL: `http://127.0.0.1:3013/demo`

Mobile verification at `390x844`:

```json
{
  "viewport": "390x844",
  "innerWidth": 390,
  "innerHeight": 844,
  "scrollWidth": 390,
  "ok": true,
  "main": {
    "x": 0,
    "right": 390,
    "width": 390,
    "gridTemplateColumns": "350px"
  },
  "children": [
    {
      "tag": "div",
      "x": 20,
      "right": 370,
      "width": 350,
      "minWidth": "0px"
    },
    {
      "tag": "aside",
      "x": 20,
      "right": 370,
      "width": 350,
      "minWidth": "0px"
    }
  ]
}
```

Desktop verification at `1440x900`:

```json
{
  "viewport": "1440x900",
  "innerWidth": 1440,
  "innerHeight": 900,
  "scrollWidth": 1440,
  "ok": true,
  "main": {
    "x": 144,
    "right": 1296,
    "width": 1152,
    "gridTemplateColumns": "784px 304px"
  },
  "children": [
    {
      "tag": "div",
      "x": 164,
      "right": 948,
      "width": 784,
      "minWidth": "0px"
    },
    {
      "tag": "aside",
      "x": 972,
      "right": 1276,
      "width": 304,
      "minWidth": "0px"
    }
  ]
}
```

Screenshots written:
- `.tmp/hermes/one-shot-app/screenshots/demo-mobile-390-post-fix.png`
- `.tmp/hermes/one-shot-app/screenshots/demo-desktop-1440-post-fix.png`

## Focused Web Gates

`pnpm --filter @klasr/web run lint`

```text
✔ No ESLint warnings or errors
```

`pnpm --filter @klasr/web run typecheck`

```text
tsc --noEmit
```

Result: passed.

`pnpm --filter @klasr/web run test`

```text
Test Files  5 passed (5)
Tests       21 passed (21)
```

Result: passed.

`pnpm --filter @klasr/web run build`

```text
✓ Compiled successfully
✓ Generating static pages (7/7)
○ /demo  2.98 kB  104 kB
```

Result: passed.

## Notes

One attempted server command was rejected before verification because the package script forwarded the port incorrectly:

```text
pnpm --filter @klasr/web run start -- -p 3013
Invalid project directory provided, no such directory: /root/projects/klasr-oneshot/klasr-loop/apps/web/-p
```

The successful server command used for evidence was:

```text
pnpm --dir apps/web exec next start -p 3013
```
