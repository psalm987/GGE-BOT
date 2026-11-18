# GGE-BOT verification map

The maintained list of what a GGE-BOT user can do in the web panel and how to prove each one. Read this index before driving, then use the matching feature file as the recipe.

## Baseline preconditions

- `gge-verify setup` has run once on this machine.
- An instance started by this run with `gge-verify up NAME` (fresh `user.db`, port from 3101 up, sign-up token `verify`, no Discord, no TLS).
- `gge-verify doctor NAME` reports `doctor: healthy`, including "built from HEAD". After editing code, `down` and `up` again; the instance is a snapshot.
- Network access to `empire-html5.goodgamestudios.com` (startup and the panel's language files need it).
- Never drive an instance this run did not start, and never the user's own bot on port 3001.

## Driving conventions

- Drive through `node .claude/skills/verify/scripts/drive.js NAME STEP...`. For paths without a step, write a one-off Playwright script the same way (see SKILL.md "Drive").
- Prefer ARIA roles and accessible names (`Settings`, `Save`, `plugins table`) and the static pages' element ids (`#username`, `#login-info-banner`) over CSS classes or position.
- Anchor account rows on the name row-header and plugin rows on the name cell, never on a button whose label changes (Start/Stop).
- drive.js creates fresh, uniquely named panel users and dummy accounts per run, so no reset is needed between runs on one instance.

## Proof and skip reporting

- Capture the action and the resulting state: screenshots around each action, `ws-frames.log` for the frame the action sent and the server's reply, and a `db-*.json` dump for the stored side effect.
- Work only through the panel. Reading `user.db` to confirm is fine; writing to it, calling `/api` directly or hand-sending WebSocket frames is not proof.
- Report a feature you could not reach (Discord without a token, `start-bot` without a live go-ahead) as not covered, with the missing precondition. Do not report it as verified through another feature.

## Feature entry contract

Each feature file has an H1, one paragraph of user-visible behavior, then four H2s in order: `Sub-features`, `How to get to it (user POV)`, `Driving it with Playwright (drive.js)` (starting with `Preconditions:`), and `Gotchas`.

## Features

- [Panel sign-up, sign-in and logout](./panel-auth.md): `signup` and `signin` steps; bad token, remember-me and logout are manual.
- [Game accounts](./game-accounts.md): `add-account` and `remove-account` steps; edit, keep-password, select-all and per-login isolation are manual.
- [Plugin settings](./plugin-settings.md): `edit-plugins` step; option values and widget kinds are manual; Discord plugins unreachable without a token.
- [Run a bot](./run-bot.md): `start-bot` step, gated behind `--live` because it logs into the real game.
- [Player docs site](./docs-site.md): `drive-docs.cjs` serves `apps/docs/dist` itself; run after `pnpm --filter @gge/docs build`.

## Not mapped yet

- **Language menu** (`EN` button in the table header: EN/PL/DE/TR/AR/CS): reloads panel strings from `/locales/<lang>.json` and the GGE language file.
- **Link Discord** button and `/discordAuth`: needs a Discord application configured in `ggeConfig.json`.
- **OR/BTH external-event accounts**: spawns a helper worker to discover the event server; needs a live account.
