# Player docs site (apps/docs)

The public GGE Command docs, built from Markdoc files with Astro Starlight. It carries the app's war-room look in dark and a parchment light theme, has callouts with link anchors (Pro tip, Heads up, Danger zone, Lore), margin side notes, and calm arrival motion when a reader lands on a `#section`.

## Sub-features

- Aside callouts with a copy-link button and a polite "Link copied" announcement.
- Side notes: a margin column at 90rem and wider, a button that expands under the paragraph below that.
- Arrival at `#heading`, aside id or side-note id: gold inline-start bar, tint fade, focus moves to the target.
- English at the root, `/de/` and `/ar/` hand-written; the other locales fall back. `/ar/` is RTL.

## How to get to it (user POV)

Open `/quick-start/`, click a heading's `#` link or an aside's link button, or visit `/quick-start/#start`. Ctrl/Cmd+K opens search. Tab first lands on the skip link.

## Driving it with Playwright (drive-docs.cjs)

Preconditions: `pnpm --filter @gge/docs build`, and Playwright and axe-core under `~/.cache/gge-bot-verify/pw/node_modules/`. No server is needed; the script serves `apps/docs/dist` itself.

```
pnpm --filter @gge/docs build
node .claude/skills/verify/scripts/drive-docs.cjs [out-dir]
```

It asserts each step and writes screenshots to `out-dir` (default `.verify-evidence/<time>-docs`): axe on `/quick-start/` and `/ar/quick-start/` in both themes at 1440 and 390, no horizontal scroll, RTL mirroring, arrival focus and reduced motion, side-note keyboard toggle, copy link, skip link first, no Starlight violet, 44px controls.

## Gotchas

- Axe runs `wcag2a`, `wcag2aa` and `wcag21aa`. `wcag21a` adds an experimental rule that flags Starlight's own search button.
- 90rem is exactly 1440px, so the 1440 lane is the wide layout; the narrow lanes use 1100 and 390.
- Known limit: margin notes close together in one paragraph can overlap, because there is no collision handling yet.
- Without JavaScript, side notes show inline and the marker button stays hidden.
- Light theme links are `#7A520A`; the contrast test (`pnpm --filter @gge/docs test`) holds every token pair to 4.5:1 text and 3:1 borders.
