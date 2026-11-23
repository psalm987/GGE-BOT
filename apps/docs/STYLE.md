# Docs style

How the player docs at docs.neisesolutions.com are written. Every English page under `src/content/docs/` follows it.

## Who reads this

Players of Goodgame Empire who use GGE Command. Many read English as a second language, and many arrive from a search for a problem ("bot won't start"). Write so a 12-year-old with school English can follow.

## Sentences

- Second person, present tense, active voice: "The bot sends your armies", not "Armies are sent".
- About 15 words per sentence. One idea per sentence.
- No idioms that don't translate ("ballpark", "out of the box", "a piece of cake").
- Say what happens, then why, then what to do. Lead with the action the player takes.
- Name the setting, button or page exactly as the app shows it.

## Voice

Plain first, with a light gamer flavour in two places only: the opening line of a page or section, and aside labels (the site adds them: **Pro tip**, **Heads up**, **Danger zone**, **Lore**). Never in headings, link text or UI names.

- Plain: "Choose Start on the account card."
- In the voice: "Ready to roll? Hit **Start** on your account card. Your bot signs in and gets to work."

## Headings

- Literal and searchable: "Stop the bot at a set time", not "Lights out".
- Every `##` heading carries an explicit id: `## Settings {% #settings %}`. Ids are lowercase words joined by dashes and never change once published, because links and translations point at them.
- Sentence case.

## App names and labels

- Print a label the app shows with the `ui` tag, so a renamed button updates the docs: `{% ui key="client:nav.logs" /%}`. The key must exist in `packages/i18n/catalogs/en/`.
- When no catalog key fits, write the label in **bold**, exactly as the app shows it.
- The product is **GGE Command**. The game is **Goodgame Empire**, or "the game" after the first mention.

## Terms

- Tag the first use of every registered term on a page: `{% term id="khan-camp" %}Khan camps{% /term %}`. The registry is `src/content/terms/en.yaml`, and a test fails on an untagged first use.
- A page that uses more than three terms starts with `{% terms_on_page /%}`.
- New jargon goes into the registry before it goes on a page: `id`, `term`, `category`, a `short` of 25 words or fewer, a `long` with a "Think of it like…" line, and an `image` from the house icons.

## Asides

- `tip`: a shortcut or a better way. `caution`: something that costs time or resources if missed. `danger`: something that risks the game account. `note`: background and the why.
- Every aside has an `id`, which makes it a link target.
- At most one aside per section. If everything is a callout, nothing is.

## Truth

- Every claim about what the bot does must match the code in `packages/bot-core/plugins/` and the option text in `packages/bot-core/locales/en`. Don't describe a setting the plugin doesn't have.
- Unfinished parts get `{% status kind="beta" /%}`. Modules marked Soon in the app get no page.
- Anything about plans or prices goes inside `{% plan_gate %}`. Until billing is live, each GGE Command account runs one bot: its oldest game account runs, the others show **Over plan limit**, and event twins don't count.
- How the bot avoids detection stays out of the docs.

## Pictures

- Only GGE Command's own screens (`{% screenshot %}`, `{% hotspots %}`) and the house icons (`{% icon %}`). No Goodgame art, logos or in-game screenshots.
- Every screenshot has `alt` text that says what the screen shows.
- Screenshots use demo data only.

## Page shape

Frontmatter: `title`, and a `description` of 160 characters or fewer that reads well as a search result.

A module page follows this order:

1. What it does, in two or three sentences, and when to use it.
2. How it works, step by step, as the bot does it.
3. `## Settings {% #settings %}` with `{% settings plugin="<key>" /%}` for each plugin the module edits.
4. Tips, limits and what's still to come.
5. Related errors, linked to their entry on the errors page.
