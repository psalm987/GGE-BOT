# Player docs site (apps/docs)

The public GGE Command docs, built from Markdoc files with Astro Starlight. It carries the app's war-room look in dark and a parchment light theme, has callouts with link anchors (Pro tip, Heads up, Danger zone, Lore), margin side notes, and calm arrival motion when a reader lands on a `#section`.

## Sub-features

- Aside callouts with a copy-link button and a polite "Link copied" announcement.
- Side notes: a margin column at 90rem and wider, a button that expands under the paragraph below that.
- Arrival at `#heading`, aside id or side-note id: gold inline-start bar, tint fade, focus moves to the target.
- English at the root, `/de/` and `/ar/` hand-written; the other locales fall back. `/ar/` is RTL.
- Generated references: `/errors/` (one entry per public error code, with fix text), `/alerts/` (one per notification kind) and a settings table per plugin (`/plugins/attack-khan/`). Each entry has an anchor, `#too-many-attack-plugins` for the code `TOO_MANY_ATTACK_PLUGINS`.
- Terms: an underlined word opens a popover (hover 300 ms, tap, Enter or Space) with a short definition and a Read more link to `/glossary/#<id>`. Under 640px it is a bottom sheet. `/glossary/` is A to Z with category filters, aliases (TOTP, 2FA), See also and Used on links. Each page's first use of a term is tagged, and a card at the top lists the page's terms.
- Tags: `term`, `terms_on_page`, `glossary`, `ui`, `settings`, `errors`, `alerts`, `status`, `plan_gate`, plus `aside` and `sidenote`. Astro builds an import named after each tag, so a tag name cannot contain a dash. That is why it is `terms_on_page`, not `terms-on-page`.

## How to get to it (user POV)

Open `/quick-start/`, click a heading's `#` link or an aside's link button, or visit `/quick-start/#start`. Ctrl/Cmd+K opens search. Tab first lands on the skip link.

## Driving it with Playwright (drive-docs.cjs)

Preconditions: `pnpm --filter @gge/docs build`, and Playwright and axe-core under `~/.cache/gge-bot-verify/pw/node_modules/`. No server is needed; the script serves `apps/docs/dist` itself.

```
pnpm --filter @gge/docs build
node .claude/skills/verify/scripts/drive-docs.cjs [out-dir]
```

It asserts each step and writes screenshots to `out-dir` (default `.verify-evidence/<time>-docs`): axe on `/quick-start/` and `/ar/quick-start/` in both themes at 1440 and 390, no horizontal scroll, RTL mirroring, arrival focus and reduced motion, side-note keyboard toggle, copy link, skip link first, no Starlight violet, 44px controls. It also drives the term popover (Enter, Space, Esc, focus return, hover delay, bottom sheet at 390, RTL), the glossary filters and their live region, search for `TOO_MANY_ATTACK_PLUGINS`, "too many attack plugins" and "TOTP", and axe on the errors, alerts, glossary and plugin pages in dark and light, en and ar, at 1440 and 390. The run takes about six minutes.

## Where the data comes from

`pnpm --filter @gge/docs generate` (it also runs before `build`, `dev`, `test` and `typecheck`) writes `apps/docs/src/generated/*.json`, which git ignores:

- `errors.json` from `apps/api/src/errors.ts` (the `ERRORS` table) plus `packages/i18n/catalogs/en/errors.json`, and the uppercase codes in `packages/bot-core/locales/en.json` (`TOO_MANY_ATTACK_PLUGINS`, `CASTLE_LOCKED`, `IS_BANNED`, `FAILED_TO_SET_CASTLE`).
- `notifications.json` from `catalogs/en/notifications.json`.
- `plugins.json` from `readPluginRegistry` (now in `packages/bot-core/pluginRegistry.mts`) with `discordHub: true`.
- `locales.json` (option labels) from `packages/bot-core/locales/*.json`; `ui.json` (app labels for the `ui` tag) from the `client`, `common` and `ui` catalogs.

Hand-written data: `src/content/errors/<locale>.yaml` and `src/content/alerts/<locale>.yaml` (fix text per code), `src/content/terms/<locale>.yaml` (the term registry), `src/data/internal-codes.ts` (admin-only codes, kept off the errors page).

## Coverage tests (run by `pnpm check`)

`apps/docs/test`: every public error code has fix text and no fix text is left for a gone code; every notification kind has fix text; term tags and `ui` keys exist; the first use of each registered term (or alias) in an English page's body text sits inside a `term` tag. The scan parses with `@markdoc/markdoc`. It skips headings, link text, code and bold text (bold is a UI name). A term and its aliases count as one term. The plugin option label test only lists what is missing. `BILLING_LIVE=1` at build time shows `plan_gate` content.

## Gotchas

- A term id must not start with a digit: Pagefind and `#id` selectors break on it (`two-factor`, not `2fa`).
- Glossary entries and error entries put their `id` on the `h3`, because Pagefind only makes sub-result anchors from headings with an id. The arrival frame is the whole entry (`.gge-gloss`, `.gge-ref`).
- The popover's `aria-expanded` follows the `toggle` event, which fires after the click, so a script must wait for it.

- Axe runs `wcag2a`, `wcag2aa` and `wcag21aa`. `wcag21a` adds an experimental rule that flags Starlight's own search button.
- 90rem is exactly 1440px, so the 1440 lane is the wide layout; the narrow lanes use 1100 and 390.
- Known limit: margin notes close together in one paragraph can overlap, because there is no collision handling yet.
- Without JavaScript, side notes show inline and the marker button stays hidden.
- Light theme links are `#7A520A`; the contrast test (`pnpm --filter @gge/docs test`) holds every token pair to 4.5:1 text and 3:1 borders.
