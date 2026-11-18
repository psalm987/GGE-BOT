# Player docs site (apps/docs)

The public GGE Command docs, built from Markdoc files with Astro Starlight. It carries the app's war-room look in dark and a parchment light theme, has callouts with link anchors (Pro tip, Heads up, Danger zone, Lore), margin side notes, and calm arrival motion when a reader lands on a `#section`.

## Sub-features

- Aside callouts with a copy-link button and a polite "Link copied" announcement.
- Side notes: a margin column at 90rem and wider, a button that expands under the paragraph below that.
- Arrival at `#heading`, aside id or side-note id: gold inline-start bar, tint fade, focus moves to the target.
- English at the root, `/de/` and `/ar/` hand-written; the other locales fall back. `/ar/` is RTL.
- Generated references: `/errors/` (one entry per public error code, with fix text), `/alerts/` (one per notification kind) and a settings table per plugin (`/plugins/attack-khan/`). Each entry has an anchor, `#too-many-attack-plugins` for the code `TOO_MANY_ATTACK_PLUGINS`.
- Terms: an underlined word opens a popover (hover 300 ms, tap, Enter or Space) with a short definition and a Read more link to `/glossary/#<id>`. Under 640px it is a bottom sheet. `/glossary/` is A to Z with category filters, aliases (TOTP, 2FA), See also and Used on links. Each page's first use of a term is tagged, and a card at the top lists the page's terms.
- SEO plumbing (`src/seo/`): a Starlight route middleware (`middleware.ts`) adds JSON-LD, social image tags, `noindex` and canonical fixes to each page's head. See "SEO" below.
- Language bar: a dismissible "Read this page in Deutsch?" overlay for a browser that prefers a locale with a real translation of the page.
- Localised 404 pages with a search box, and a `?q=` query that opens search pre-filled.
- Tags: `term`, `terms_on_page`, `glossary`, `ui`, `settings`, `errors`, `alerts`, `status`, `plan_gate`, plus `aside` and `sidenote`. Astro builds an import named after each tag, so a tag name cannot contain a dash. That is why it is `terms_on_page`, not `terms-on-page`.

## How to get to it (user POV)

Open `/quick-start/`, click a heading's `#` link or an aside's link button, or visit `/quick-start/#start`. Ctrl/Cmd+K opens search. Tab first lands on the skip link.

## Driving it with Playwright (drive-docs.cjs)

Preconditions: `pnpm --filter @gge/docs build`, and Playwright and axe-core under `~/.cache/gge-bot-verify/pw/node_modules/`. No server is needed; the script serves `apps/docs/dist` itself.

```
pnpm --filter @gge/docs build
node .claude/skills/verify/scripts/drive-docs.cjs [out-dir]
```

It asserts each step and writes screenshots to `out-dir` (default `.verify-evidence/<time>-docs`): axe on `/quick-start/` and `/ar/quick-start/` in both themes at 1440 and 390, no horizontal scroll, RTL mirroring, arrival focus and reduced motion, side-note keyboard toggle, copy link, skip link first, no Starlight violet, 44px controls. It also drives the term popover (Enter, Space, Esc, focus return, hover delay, bottom sheet at 390, RTL), the glossary filters and their live region, search for `TOO_MANY_ATTACK_PLUGINS`, "too many attack plugins" and "TOTP", and axe on the errors, alerts, glossary and plugin pages in dark and light, en and ar, at 1440 and 390. It then runs the SEO lanes: one canonical, a description of 160 characters or fewer and valid JSON-LD on every content page; fallback pages `noindex` with an English canonical; the German quick start with a self canonical and a German image; every `og:image` exists and is 1200x630; the sitemap lists no `noindex` page; `robots.txt`, `llms.txt`, `llms-full.txt` and a 404 for each locale; the 404 search box and `?q=`; the language bar (shows for a `de` browser, not on a fallback page, stays dismissed after a reload, axe clean, 44px close, nothing moves); and a `DOCS_NOINDEX=1` build into the evidence folder with the robots meta on every page. `DOCS_DRIVE_ONLY=seo` runs only those lanes. The full run takes a few minutes.

## SEO

- **Frontmatter** (`src/data/frontmatter.ts`, extended into `docsSchema`): `description` required and 160 characters or fewer; optional `appRoute`, `plugin`, `sources`, `status`, `related`, `updated`. `test/frontmatter.test.ts` runs every page through it.
- **JSON-LD** (`src/seo/jsonld.ts`, typed builders with tests): `TechArticle` and `BreadcrumbList` on every page, `DefinedTermSet` on `/glossary/`, `Organization` and `SoftwareApplication` on the home page, all with `inLanguage`. A fallback page says `en` and uses the English URL. Breadcrumbs read the sidebar (`src/theme/sidebar.ts`): home, the group, the page. The group links to its first page, because a group has no page of its own.
- **Fallback pages** (a locale with no translation): `noindex` and a canonical to the English page. A page with a real translation keeps a self canonical. `hreflang` lists only the real translations plus `x-default`. Starlight's sitemap lists every locale of every page, so `src/seo/sitemap.ts` runs after it and removes `noindex` pages and the alternates that point at them.
- **Social images**: `src/pages/og/[...route].ts` (astro-og-canvas) writes `/og/<locale>/<slug>.jpeg`, 1200x630, about 30 kB each. The home page is `home`. A translated page has an image in its own locale; a fallback uses the English one. `canvaskit-wasm` must stay external to Vite (`vite.ssr.external`). The crest PNG is redrawn from `crest.svg` with sharp into `node_modules/.cache/gge-docs/`.
- **Discovery**: `public/robots.txt`; `/llms.txt` and `/llms-full.txt` from `src/seo/llms.ts` (English only, Markdoc turned into plain Markdown, the glossary and the error and alert lists expanded). `starlight-llms-txt` does not work here, because it renders each entry through Astro and our tags need the Starlight route.
- **404**: `disable404Route` is on. `src/pages/404.astro` is `/404.html`; each other locale is `/<locale>/404/index.html`, which phase 8 maps in Caddy. Both are `noindex`.
- **Redirects**: `redirects: {}` in `astro.config.mjs`; phase 8 turns entries into Caddy 301s.
- **Preview builds**: `DOCS_NOINDEX=1 pnpm --filter @gge/docs build` adds `<meta name="robots" content="noindex">` to every page. Production gets its header from Caddy.
- **Language bar**: `src/seo/langbar.ts` (options per page), `src/scripts/langbar.ts` (shows it), `src/seo/pick-locale.ts` (walks `navigator.languages` and stops at the page's own language). It is a fixed overlay, so nothing shifts; a polite status region; a 44px close; focus moves to `main` when it goes; a dismissal is `gge-langbar-dismissed` in localStorage and the bar still works when storage throws.
- Not checked locally: Google's Rich Results test (an external service) and Lighthouse (no cached copy, no network use). The driver validates the JSON-LD by parsing it and checking each type's required properties.

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

- Starlight gives a fallback route an id with the locale prefix (`de/plugins/attack-khan`) but keeps the English entry in `route.entry`, and the home page has an empty id. The middleware therefore reads `route.entry.id` through `slugOf`.
- Axe runs `wcag2a`, `wcag2aa` and `wcag21aa`. `wcag21a` adds an experimental rule that flags Starlight's own search button.
- 90rem is exactly 1440px, so the 1440 lane is the wide layout; the narrow lanes use 1100 and 390.
- Known limit: margin notes close together in one paragraph can overlap, because there is no collision handling yet.
- Without JavaScript, side notes show inline and the marker button stays hidden.
- Light theme links are `#7A520A`; the contrast test (`pnpm --filter @gge/docs test`) holds every token pair to 4.5:1 text and 3:1 borders.
