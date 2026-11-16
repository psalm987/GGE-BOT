---
name: verify
description: Drive GGE-BOT's web apps with Playwright the way a person does and keep screenshots as proof. Two surfaces. The new stack (apps/client player app, apps/admin admin app, apps/api, apps/runner) runs under `pnpm dev`, with drive-client.cjs and drive-admin.cjs covering open sign-up, the email gate, accounts, start/stop, admin two-factor sign-in, users, force stop, audit, axe and phone widths. The legacy panel (main.js plus website/) runs in an isolated copy via gge-verify and drive.js. Use to prove a change to any app, the API, the runner, packages/ui or packages/bot-core works in the real app, not just in tests.
---

# verify — drive GGE-BOT for real

## New stack: player app and admin app

All commands run from the repo root. The drivers use the Playwright and axe-core install that `gge-verify setup` puts in `~/.cache/gge-bot-verify/pw` (see Launch below).

1. **Start the stack** in the background: `pnpm dev > /tmp/gge-dev.log 2>&1`. It starts a throwaway Postgres, migrates, seeds demo data and starts the API on :3000, the player app on :5173 and the admin app on :5174. The runner is off, so nothing contacts the game. Pass `--runner` only with the user's go-ahead. With `CENTRIFUGO_BIN=<path to centrifugo>` (or `centrifugo` on PATH) it also starts Centrifugo, which the live-update checks need.
2. **Wait until it's ready**: `curl -sf localhost:5173 && curl -sf localhost:5174 && curl -sf 127.0.0.1:3000/healthz`.
3. **Drive**:
   - `node .claude/skills/verify/scripts/drive-client.cjs`: open sign-up (password row side by side at 1280 px and stacked at 390 px, mismatch caught), the email gate until the emailed link is opened, add an account (then the one-bot limit: Add account disabled with an explanation, a direct API create refused), start and stop it (optimistic, survives reload, and with Centrifugo running a second tab shows the stop live), edit with the discard guard, then confirmed remove. It also covers the empty notification bell, the Settings "Email me when…" switches (defaults, and kept across a reload), Settings change-password and forgot-password, reset link and sign-in by email. It ends with the account self-service cards on the same player: **Download my data** (the file is saved to the evidence folder and checked for passwords, then the rate-limit message), **Change email** (the link from the log, confirmed in a signed-out browser, then sign-in with the new address), and **Delete account** (the dialog, then the sign-in page's message and a refused sign-in). So each run uses one sign-up and leaves no player behind. The log mailer prints each email to `/tmp/gge-dev.log` (set `DEV_LOG` if the stack logs elsewhere), and the script reads links from there. Runs axe on each screen.
   - `node .claude/skills/verify/scripts/drive-admin.cjs`: a player is refused; the admin's password leads to the authenticator code step, the **Use a recovery code** toggle swaps the field (screenshot only, no code is spent), a 5-digit code is caught, and a current code signs in; overview with the runner warning and no Invites page; force-stop Ironhold; disable and re-enable `demo`; raise `demo`'s bot limit on the Users page and watch a create go from refused to allowed, then restore it; self-disable is refused and the admin's own row has no **Reset 2FA**; the audit trail; **Settings** regenerates recovery codes with a current code and shows 10 once; no horizontal overflow at 390 px on every page.

   Each prints `ok:` lines and `axe <screen>:` results. Screenshots go to `.verify-evidence/<time>-client|admin/`, or to a folder passed as the first argument. Point them elsewhere with `CLIENT_URL`, `ADMIN_URL` and `API_URL`.
4. **Pass** means every `ok:` line printed, the script exited 0, and every axe line reads "no WCAG A/AA violations".
5. **Stop** with SIGINT (`kill -INT <pnpm dev pid>`) so `tools/dev` stops and deletes its throwaway Postgres. A SIGKILL leaves a `gge-pg-*` cluster running in `$TMPDIR`. Stop it with that Postgres's `pg_ctl -D <dir> stop`, then delete the folder.

Gotchas:
- **Seeded `demo` and `admin` have confirmed emails**, so the gate never shows for them. A fresh sign-up is gated until its link is opened.
- **A game account is unique per (server, name, event flag) across all players.** `drive-client.cjs` uses a fresh account name each run.
- **Admin sign-in needs an authenticator code.** `pnpm dev` seeds `admin` with a fixed secret and prints it in its banner. [dev-totp.cjs](scripts/dev-totp.cjs) holds the same secret and computes codes with `node:crypto`: `nextCode()` for a browser flow, `adminSessionCookie()` for API calls. The API refuses a code for a step it already accepted, so never reuse a code. `nextCode()` hands out the next step's code for a second sign-in in the same 30 seconds and waits for the clock before a third. A code spent by a run that just ended is refused once; both helpers retry with the next one.
- **The enroll flow is not in the drivers**, because it would replace the seeded secret. To drive it, reset the admin first with `DATABASE_URL=<the dev Postgres> node apps/api/src/cli/reset-2fa.ts --username admin` (the `pnpm dev` banner prints the URL), sign in, read the setup key off the page and compute the code with `totpCode(key, stepNow())`. Restart `pnpm dev` afterwards to get the seeded secret back.
- **`drive-admin.cjs` changes demo data.** It sets Ironhold back to running at the start, because its force-stop step stops it.
- **A bot's status only changes while a runner is up**, so the drivers prove live updates with what the API publishes itself: a start or stop reaching a second tab. To see a live status or log line without contacting the game, run the real `Supervisor` and store against the dev Postgres with a worker that only posts messages.
- **A notification only appears when a runner ends a bot** (banned, rejected password, crash loop, shutoff timer), so the drivers cover the empty bell and the email switches only. To see one arrive, run the real `Supervisor` and store against the dev Postgres with a worker that posts `[20, { state: "banned", reason: "IS_BANNED" }]`, on an account the signed-in player already lists. The bell counts it at once, and the API logs its `bot_alerts` email 30 to 45 seconds later.
- **Kill Centrifugo by its own pid**, never by pattern across `pnpm dev` trees. `pnpm dev` keeps running without it, and the app shows "Reconnecting…" and refetches every 15 seconds. To bring it back, start the binary again with the `CENTRIFUGO_*` variables `tools/dev/dev.ts` gives it.
- **antd 6 renders a modal's title twice** (`ant-modal-title` and `ant-modal-confirm-title`). Select dialogs with `getByRole("dialog", { name })`.

The rest of this file is the legacy panel.

GGE-BOT is a Node server ([main.js](../../../main.js)) that serves a React control panel (the separate `GGE-BOT-Website` repo, cloned into `website/` and built to `website/build`) and runs one worker thread ([ggeBot.js](../../../packages/bot-core/ggeBot.js)) per game account. Users touch it only through the panel:

- `signup.html` / `signin.html`: static forms that POST to `/api` (`id:1` signup, `id:0` login) and set a `uuid` cookie.
- `index.html`: the React users table. Everything after login goes over one WebSocket on the same port, as `[ErrorType, ActionType, payload]` JSON frames (codes in [actions.json](../../../packages/bot-core/actions.json) and [errors.json](../../../errors.json)).
- State lives in `user.db` (SQLite): `Users` = panel logins, `SubUsers` = game accounts, with `state` (0 stopped, 1 running) and a `plugins` JSON blob.

Secondary surfaces, not driven here: the Discord bot (needs `discordToken`/`discordClientId`; with them unset, `plugins/discord/*` are not even loaded) and the game itself (each started account's worker opens a websocket to the live Goodgame Empire servers).

All commands below run from the repo root.

## Launch

One-time per machine (idempotent; skips what exists):

```bash
.claude/skills/verify/scripts/gge-verify setup
```

It runs `npm i` in the repo, clones `GGE-BOT-Website` into `website/` and builds it (`website/` and `node_modules/` are gitignored, same as `start_linux.sh` does), and installs `playwright@1.57.0` into `~/.cache/gge-bot-verify/pw` (matches the cached Chromium 143 build). It never touches `ggeConfig.json` or `user.db` in the repo.

Start an instance (NAME is `[a-z0-9-]+`, PORT optional; default is the first free port from 3101, so it never collides with a user's own bot on 3001):

```bash
.claude/skills/verify/scripts/gge-verify up v1
# ready: name=v1 pid=12345 url=http://127.0.0.1:3101 signupToken=verify dir=~/.cache/gge-bot-verify/instances/v1
```

What `up` does, and why:

- Copies the working tree (minus `.git`, `node_modules`, `website`, `user.db*`, `ggeConfig.json`, `credentials/`, caches) to `~/.cache/gge-bot-verify/instances/NAME/app`, symlinking `node_modules` (the root's and each `packages/*`'s) and `website`. A copy is required: `main.js` keeps `user.db`/`ggeConfig.json` in cwd, but bot-core resolves its game data (`data/`) relative to its own files, so a different cwd alone would share the repo's data.
- Writes a fresh `ggeConfig.json`: the chosen `webPort`, `signupToken: "verify"`, no Discord, no TLS.
- Starts `node --no-warnings main.js` with output in `instances/NAME/server.log`, pid in `instances/NAME/pid`.
- **Ready** = the log has the line `Started.` (printed after the HTTP server is listening) **and** `GET /signin.html` returns 200. Startup creates the `user.db` tables (empty data dir is fine) and downloads `data/items/`, `data/lang/en.json` and `data/1.xml` from `empire-html5.goodgamestudios.com`. The first `up` on a machine caches them in `~/.cache/gge-bot-verify/seed/` and later instances copy them, but startup still fetches `ItemsVersion.properties` every time, so **the network to goodgamestudios.com is required**: offline, `main.js` crashes before `Started.`.
- **The instance is a snapshot.** Edits made after `up` are not in it. After changing code, `down` and `up` again.

Isolation: instances with different NAMEs run side by side (own dir, own port, own DB). `up` refuses a NAME that is still running and a PORT that is taken. Never point the driver at the user's own bot on 3001.

## Doctor

Read-only. Run it first, and whenever anything looks off:

```bash
.claude/skills/verify/scripts/gge-verify doctor v1
```

Checks: recorded pid alive; that pid (not some other process) listens on the port; `Started.` logged; `/signin.html` 200; `/index.html` serves the React bundle (`static/js/main.*`, i.e. `website/build` exists); `/api` answers a bogus login with `Invalid login details.`; `user.db` exists; instance was built from the current `HEAD`. It also prints how many tracked files were modified when the snapshot was taken. Exit 1 if any check fails. `gge-verify logs v1` tails the server log; `gge-verify list` shows all instances.

## Drive

```bash
node .claude/skills/verify/scripts/drive.js v1 signup add-account edit-plugins remove-account
```

Steps run in order in one headless Chromium context (`--headed` to watch). Any step that needs a logged-in panel signs up a fresh web user first (`verify-HHMMSS`, token `verify`), and steps that need a game-account row add one first (`dummy-HHMMSS` with a fake password; it is never started). Each step asserts on both the UI and `user.db`.

| Step | What a user does | Proof asserted |
|---|---|---|
| `signup` | `/signup.html`: fill `#username`, `#password`, `#token`, click **Signup** | lands on `/index.html` with the users table; `Users` row whose `uuid` equals the cookie |
| `signin` | clears cookies; `/index.html` must bounce to `/signin.html`; wrong password shows `Invalid login details.` in `#login-info-banner`; right one lands on the table | same `uuid` cookie as signup |
| `add-account` | **+** button, fill **Username** / **Password** labels, optional server (`--server ID`, the `value` attribute of an `<instance>` in `1.xml`), **Save** | row with the name appears; exactly one `SubUsers` row, `state = 0` |
| `edit-plugins` | row's **Settings**, click the first plugin with an enabled **Start** in the plugins table, toggle it, **Save** | plugin button flips to **Stop**; exactly one plugin newly `state:true` in `SubUsers.plugins`; account still `state = 0`; Plugins column shows it |
| `remove-account` | tick the row checkbox, **Remove** | row detaches; `SubUsers` row gone |
| `start-bot` | row's **Start**, wait, open **Logs**, then **Stop** | `SubUsers.state` 1 then 0; logs and status screenshots |

Handles used (stable ones from the panel source; keep them current): form ids `#username #password #token #email_name #login-info-banner`; ARIA names `Name` (column header), `+`, `Save`, `Settings`, `Logs`, `Start`/`Stop`, `Remove`; the plugins table's `aria-label="plugins table"`; the server dropdown `#simple-select` with `li[data-value=ID]`; account rows found by their row-header cell text.

**`start-bot` logs into the live Goodgame Empire servers with a real account.** It refuses to run without `--live --game-name N --game-pass P --server ID`. Only run it when the user has asked for that run; a bot login can get the account flagged. Real accounts are in `credentials/credentials.json` (gitignored; never copy its contents into evidence, logs, or messages). Its `server` field is a display name like `india 1`; map it to the instance `value` in the instance's `1.xml`.

For anything the step list does not cover, write a one-off Playwright script the same way: require `~/.cache/gge-bot-verify/pw/node_modules/playwright`, read the port from `~/.cache/gge-bot-verify/instances/NAME/port`, record `page.on('websocket')` frames, and assert on `gge-verify db NAME`.

## Evidence

Every `drive.js` run writes `.verify-evidence/<UTC timestamp>-<steps>/` in the repo (gitignored), and prints the path:

- `NN-<step>-<moment>.png`: full-page screenshots before the action, after it, and on failure (`<step>-failure.png`).
- `ws-frames.log`: every panel WebSocket frame, `>` sent / `<` received, so the action (`[0,4,{...}]` AddUser, `[0,2,{...}]` SetUser, ...) and the server's reply are both on record.
- `db-<moment>.json`: `user.db` dumps (`Users`, `SubUsers` with parsed `plugins`) after each mutating step: the side effect, not just the screen.
- `browser-console.log`, `server.log` (copied at the end), `transcript.txt` (every assertion and `RESULT: PASS|FAIL`).

Proof standards:

- Drive the panel like a user. Do not `INSERT` into `user.db`, `fetch('/api')` or hand-send WebSocket frames to make a step pass; that skips the code under test. Reading the DB to confirm a side effect is fine and expected.
- Capture the action and the resulting state, and confirm the side effect in `db-*.json` alongside the screenshot.
- A plugin change only reaches a running bot through `SetUser` → worker restart or `SetPluginOptions`. Proving that needs `start-bot`; a `state = 0` account only proves the setting is stored.
- No mocks. The game servers are the only external system, and the only safe boundary is not starting a bot. There is no dry-run mode.
- If a step fails because a precondition is missing (no plugin with options, server list empty), report the failure and note the reason in that feature's Gotchas. Do not weaken the step.

## Cleanup

```bash
.claude/skills/verify/scripts/gge-verify down v1
```

Kills only the recorded pid, and only if it is still a `main.js` process (bot workers are threads of that process, so they go with it), then deletes `~/.cache/gge-bot-verify/instances/v1`. It never touches `.verify-evidence/`, the seed cache, `pw/`, or the repo. Run `gge-verify list` afterwards; nothing you started should remain. Run `down` after failed attempts too.

## Helpers

- `.claude/skills/verify/scripts/gge-verify setup | up NAME [PORT] | doctor NAME | db NAME [OUTFILE] | logs NAME | down NAME | list`
- `node .claude/skills/verify/scripts/drive.js NAME STEP... [--label L] [--headed] [--server ID] [--game-name N --game-pass P --live]`
- `GGE_VERIFY_HOME` overrides `~/.cache/gge-bot-verify`.

## Feature map

[features/README.md](features/README.md) lists the user-facing features and how to drive each one. A proof is incomplete if it drives one entry point when the map lists others. Keep the map current with `/maintain-verification-skill`.
