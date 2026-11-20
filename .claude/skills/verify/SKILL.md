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
   - `node .claude/skills/verify/scripts/drive-client.cjs`: open sign-up (password row side by side at 1280 px and stacked at 390 px, mismatch caught), the email gate until the emailed link is opened, add an account (the Daily login bonus and Tax collector plugins are listed and off, and one turned on is still on when the account is reopened; then the one-bot limit: Add account disabled with an explanation, a direct API create refused), start and stop it (optimistic, survives reload, and with Centrifugo running a second tab shows the stop live), edit with the discard guard, then confirmed remove. On a started account it sets a run schedule in the **Schedule** tab (a window two hours from now, the jitter slider, "ends next day", an invalid window refused), checks that the row and the drawer show **Sleeping until** the time the preview gave, that the schedule survives a reload, and that turning it off clears the sleeping state. It then adds an account with a schedule set in the add-account drawer (the preview says "about" while the times vary, and is exact with no variation), starts it, and checks that the row shows **Sleeping until** that time and that **Need attention** stays at 0. As the seeded `demo` it drives the logs: the account drawer's **Logs** tab shows only that account's lines (a fresh line for another account stays out, and its level filter narrows the list), and the **Logs** page (`/logs`) counts every line, narrows the list and the URL with the text filter, the Error level, the tag select, a click on a row's tag and a click on its account chip, keeps the filters across a reload and Back/Forward, downloads only the filtered lines as .txt, and clears them. It then writes lines with `dev-db.cjs` to prove live following: a line lands at the bottom while following; after scrolling up the next one shows **1 new line · Jump to latest**, which lands back on it. A crash-loop notification written the same way leads through **View logs for Ironhold** to that account's errors. At 390 px the **Filters (n)** drawer sets the level, and nothing overflows at 390 or 320. It also covers the empty notification bell, the Settings "Email me when…" switches (defaults, and kept across a reload), Settings change-password and forgot-password, reset link and sign-in by email. It ends with the account self-service cards on the same player: **Download my data** (the file is saved to the evidence folder and checked for passwords, then the rate-limit message), **Change email** (the link from the log, confirmed in a signed-out browser, then sign-in with the new address), and **Delete account** (the dialog, then the sign-in page's message and a refused sign-in). As `demo` it also drives the module pages, reached through the sidebar's filter box and the account picker (at 390 px the sidebar is a drawer behind **Open menu**). On **Nomads, Samurai and Daimyo** the Attack Nomads row shows the seeded **Waiting** status with its reason, the page has no Simple/Advanced toggle and no Setup checks, and the Dry run option shows with the rest; a real change brings up the sticky save bar, and **Discard changes** puts the saved value back. On the dev-only **Settings preview (dev only)** module (the sidebar shows it only where the catalog has that plugin) it checks the peace warning, reorders the banner list with Alt+Down and a Move up button (and the live-region announcement), sets the number, the castle picker and a Rows row (an unfinished row is refused under its field), saves from the save bar, reads the stored options back through the API, reopens the page to see them. The Toolsmith (**Refinery and toolsmith**) and Buy tools (**Armourer**) pages get the same no-toggle, no-checks look, and it puts Ironhold's plugin settings back at the end. It then drives plans and banners with two fresh players made through the API: with billing off there is no **Plan** nav, `/plan` sends the player home, Settings shows only the four bot email switches, and an admin's announcement shows under the header and stays closed after a reload. With the stack started on the stub Paystack (below) it goes on: the admin's **Billing** page warns about the test key, prices Basic at 5.00 USD, and **Go live** shows the trial summary; the player sees the 7-day trial banner and the **Plan** page, pays for Basic through the stub and lands on **Payment received** with 1 point; the admin records a Team-5 purchase on the player's **Plan** tab; the player sees 5 codes; a second player opens `/redeem?code=…` signed out, signs in and the code is redeemed; **Back to free** takes the banner and the nav away. Both players are deleted at the end. Without a Paystack key the live part prints a skip line. So each run leaves no player behind. The log mailer prints each email to `/tmp/gge-dev.log` (set `DEV_LOG` if the stack logs elsewhere), and the script reads links from there. Runs axe on each screen. `DRIVE_ONLY=sidebar` runs only the sidebar step as `demo`: every module is a link, one is current, a group folds, the filter box narrows the list and ArrowDown moves into it, a coming-soon page has no form or switch and links to Discord, an old `/?account=&plugin=` link lands on the module page, an unsaved change is guarded on switching account and on leaving through the sidebar, the "Settings moved to the sidebar" notice shows once, and at 390 px the sidebar is a drawer that closes on navigation; axe and screenshots at 1440 and 390. `DRIVE_ONLY=ux-narrow` runs only the narrowing: a module page with no Setup checks and no Simple/Advanced toggle, **Send wolves only** instead of dogs, **clicks** instead of tiles on Feather beyond and the search radius (and in Arabic), **Virtual presets** reading "0 of 30 presets", "30 of 30 presets" with **New preset** disabled and its reason beside it, and "29 of 30 presets" after one is removed, and a sidebar kept at its scroll position across a group heading, a module link and a move to the Logs page at a 1440 by 520 window; axe at 1440, 390 and in Arabic. `DRIVE_ONLY=plugin-settings` runs only the module settings pages, and `DRIVE_ONLY=glory-settings` only the Attack Foreign Lords and Attack Bloodcrows tabs of **Invasion events**: every option showing, dethrone off with its caps at 0, attacking under protection off with its warning, axe, and screenshots at 1440 and 390. `DRIVE_ONLY=station-settings` runs only the **Alert and autostation** page (the 60-second lead, the gate fallback off with its ruby cost in the label, a fixed destination row picked by kingdom name, Dry run showing with the rest) and an incoming-attack notification in the bell, whose **View logs** link opens that account's Auto Station lines; axe and screenshots at 1440 and 390 go to `station-run/` in the evidence folder. `DRIVE_ONLY=armies` runs only the army settings on **Fortress** and the **Virtual presets** page: the Autofill or Waves switch and its one-line summary, the wave editor (each wave opened, an in-game preset and its warning, custom flank slots, a support tool, a courtyard row), a save read back through the API and after a reload, a virtual preset made, sent by the module, refused for deletion while a module sends it, then deleted; axe at 1440 and 390 and in Arabic, with Ironhold's settings put back at the end. `DRIVE_ONLY=towers` runs only the **Towers** page: a panel for each kingdom in the order Green, Sands, Ice, Fire with its KID, the box in a header turning the kingdom on and opening it, a config written straight to the table with the old horse, tool and wave options shown as the same choices (`dev-db.cjs`'s `storePluginSettings`), the source castle picker listing only the kingdom's castles, a kingdom with no castle saying so, the sliders and their fields moving together, **Apply to all kingdoms**, a save read back through the API, the commander field's roster line against Ironhold's seeded 18 commanders and the **All kingdoms** card's commanders configured, maximum and remaining, the **All kingdoms** card with the daily cap, a warning when the kingdoms ask for more than it, the commanders configured, maximum and remaining, and what is coming soon, and **Duplicate** on Virtual presets; axe at 1440 and 390 and in Arabic. `DRIVE_ONLY=event-camps` runs only the Attack Nomads and Attack Samurai tabs of **Nomads, Samurai and Daimyo**: configs written straight to the table with the old horse, event tool and text score options shown as the same choices, the mode showing and hiding Camp X, Camp Y and the skip types, **Keep the game's current difficulty**, the source castle picker listing only the Great Empire's castles, By distance showing **Feather beyond**, the Tools, Waves, sides and Minimum troops options with the army line that sums them up, **Apply to all events**, the **All events** card with the daily cap, the commanders and what is coming soon, a save read back through the API and after a reload; axe at 1440 and 390 and in Arabic, with Ironhold's settings put back at the end.
   - `node .claude/skills/verify/scripts/drive-admin.cjs`: a player is refused; the admin's password leads to the authenticator code step, the **Use a recovery code** toggle swaps the field (screenshot only, no code is spent), a 5-digit code is caught, and a current code signs in; overview with the runner warning and no Invites page; the Accounts table and the user page's Accounts tab show **Sleeping until** for Ironhold, which the script gives a schedule through the player API and takes off again at the end; **Runs and logs** of Ironhold shows its log in the terminal in English, newest at the bottom, with a fresh line of Ravenmoor's left out; force-stop Ironhold; disable and re-enable `demo`; raise `demo`'s bot limit on the Users page and watch a create go from refused to allowed, then restore it; self-disable is refused and the admin's own row has no **Reset 2FA**; the audit trail; **Settings** regenerates recovery codes with a current code and shows 10 once; **Proxies** adds a proxy (a bad scheme and a missing port are caught in the form), checks that the row and the list response show only `scheme://host:port`, renames it with the URL left empty, switches it off and on, pins Ravenmoor to it on the Accounts table and sees the pin on the user page and in the proxy's load, then deletes it and finds all four actions in the audit; **Billing** shows the switch and the key, and each tab passes axe; **Announcements** publishes a critical announcement from the drawer, whose preview follows the severity, title and close switch, lists it as live, ends it, and finds both in the audit; no horizontal overflow at 390 px on every page.

   `DRIVE_ONLY=phase4 node .claude/skills/verify/scripts/drive-client.cjs <out-dir>` runs only the account and dashboard steps as the seeded `demo`, and the full run includes them after the logs. **Overview**: an account's drawer opens on the Overview tab with six KPI tiles in tabular figures (the figures are written with `dev-db.cjs`'s `insertResources`, a second report reaches the open tab, a figure the game left out shows a dash with a spoken reason), an account the plan doesn't cover says so with no Start button, and a stopped account that never reported shows an empty state with Start. **Errors split**: lines written at level 3 and level 2 make the Overview's top errors list the class in words with an icon, and the Logs page's level filter offers **Game said not now** (`level=3` in the URL, kept across a reload). **Dashboard home**: the Attacks and Errors tiles match `logs/activity`, each names its window, the footnote states the 500-line, 7-day bound, Top accounts ranks by attacks and opens a drawer, the roster is still under it, nothing overflows at 390 or 320, and a fresh player with two accounts and no attacks sees the empty state. **Command palette**: the other platform's modifier does nothing, then Meta+K (Ctrl+K off macOS) opens it with the search box focused, the combobox and listbox are named, arrows, Home and End move and wrap, Tab and Shift+Tab stay inside, Escape returns focus to the button it came from, and a page, an account, a plugin (opens that plugin's module page for the account), a language and Sign out each work; at 390 and 320 the account menu opens it.
   `DRIVE_ONLY=phase-c node .claude/skills/verify/scripts/drive-client.cjs <out-dir>` drives the Nomads, Samurai and Daimyo page, Khan, Green Berimond and Storms as `demo`. Each page opens on a config stored before its new options (`wavesTillChests`, `buyDecoration`) and must show what that config always meant. The step then picks one camp at 640:12, Khan's tablets-only and taunt limit, the red camp side, and a Storm fort order, decoration and ladder stock, saves, reads the stored options back through the API and reloads. It runs axe at 1440 and 390 and again in Arabic, and puts Ironhold's settings back.

   `drive-admin.cjs` also checks that the Billing Packages tab and the Purchases tab name packages Basic, Team 5 and Team 10 rather than by id, and the admin palette (pages and Sign out only).

   `LANGS=ar,hu,it,de node .claude/skills/verify/scripts/drive-languages.cjs [out-dir]` visits the dashboard home, an account drawer (Overview and Plugins), the Attack Nomads and Attack Foreign Lords dialogs, filtered Logs, Settings, the bell, the palette, and the admin Users and Billing pages in each language, at 1440 and 390. It sets the language with `account.setLocale` for `demo` (and `gge.locale` for the admin app), then asserts `lang`, `dir` and no horizontal overflow, runs axe, and flags any run of three or more English words that also appears in the English catalogs. It prints sample numbers and dates and exits 1 on any FAIL line. With `GGE_DEV_PORT_SHIFT` set, point `CLIENT_URL`, `ADMIN_URL`, `API_URL` and `DEV_LOG` at the shifted stack. Screenshots go to `.verify-evidence/languages-run/<lng>/`.

   For the billing steps start the stub first: `node .claude/skills/verify/scripts/stub-paystack.cjs 8090`, then `PAYSTACK_SECRET_KEY=sk_test_dummy PAYSTACK_BASE_URL=http://127.0.0.1:8090 pnpm dev`. The stub's checkout page marks the transaction paid and redirects to `/plan/return?reference=…`, as Paystack's hosted page does. Going live gives the seeded `demo` its trial too; back to free leaves it on `max_bots` again.

   With `GEOIP_URL` set, `drive-client.cjs` also checks IP language detection: start `node .claude/skills/verify/scripts/stub-atlas.cjs 8089` (every 93.x.x.x address is Italy), then `GEOIP_URL=http://127.0.0.1:8089 pnpm dev`. A fresh browser sent from an Italian IP opens in Italian, a Polish pick as `demo` follows the account to a second fresh browser, and the step ends with Automatic saved back. Without `GEOIP_URL` the step prints a skip line.

   Each prints `ok:` lines and `axe <screen>:` results. Screenshots go to `.verify-evidence/<time>-client|admin/`, or to a folder passed as the first argument. Point them elsewhere with `CLIENT_URL`, `ADMIN_URL` and `API_URL`.
4. **Pass** means every `ok:` line printed, the script exited 0, and every axe line reads "no WCAG A/AA violations".
5. **Stop** with SIGINT (`kill -INT <pnpm dev pid>`) so `tools/dev` stops and deletes its throwaway Postgres. A SIGKILL leaves a `gge-pg-*` cluster running in `$TMPDIR`. Stop it with that Postgres's `pg_ctl -D <dir> stop`, then delete the folder.

Gotchas:
- **Seeded `demo` and `admin` have confirmed emails**, so the gate never shows for them. A fresh sign-up is gated until its link is opened.
- **A game account is unique per (server, name, event flag) across all players.** `drive-client.cjs` uses a fresh account name each run.
- **Admin sign-in needs an authenticator code.** `pnpm dev` seeds `admin` with a fixed secret and prints it in its banner. [dev-totp.cjs](scripts/dev-totp.cjs) holds the same secret and computes codes with `node:crypto`: `nextCode()` for a browser flow, `adminSessionCookie()` for API calls. The API refuses a code for a step it already accepted, so never reuse a code. `nextCode()` hands out the next step's code for a second sign-in in the same 30 seconds and waits for the clock before a third. A code spent by a run that just ended is refused once; both helpers retry with the next one.
- **The enroll flow is not in the drivers**, because it would replace the seeded secret. To drive it, reset the admin first with `DATABASE_URL=<the dev Postgres> node apps/api/src/cli/reset-2fa.ts --username admin` (the `pnpm dev` banner prints the URL), sign in, read the setup key off the page and compute the code with `totpCode(key, stepNow())`. Restart `pnpm dev` afterwards to get the seeded secret back.
- **`drive-admin.cjs` changes demo data.** It sets Ironhold back to running at the start, because its force-stop step stops it. It also gives Ironhold a schedule for the length of the run. A run that fails midway leaves that schedule on until the next run ends.
- **A bot's status only changes while a runner is up**, so the drivers prove live updates with what the API publishes itself: a start or stop reaching a second tab. To see a live status without contacting the game, run the real `Supervisor` and store against the dev Postgres with a worker that only posts messages.
- **A log line or a notification without a runner**: [dev-db.cjs](scripts/dev-db.cjs) writes one into the dev Postgres the way the runner's store does, with its Centrifugo outbox row in the same transaction, so open pages get it live. `node .claude/skills/verify/scripts/dev-db.cjs log Ironhold 1 feast notEnoughFoodToFeast` or `... notify Ironhold`; the drivers `require` it. It reads the Postgres URL from the `pnpm dev` banner in `DEV_LOG`, or `DATABASE_URL`.
- **A window closing or opening only stops or starts a bot while a runner is up.** The driver proves the sleeping state, which the API works out by itself. To see the runner stop a bot with the run reason **Window closed**, run the real `Supervisor` and store against the dev Postgres with a worker that only posts messages, on an account whose window ends a minute from now, and call `loadSpecs` every few seconds.
- **A notification only appears when a runner ends a bot** (banned, rejected password, crash loop, shutoff timer). `dev-db.cjs notify` writes a crash-loop one already marked emailed, which is enough for the bell and its **View logs** link; to see the email go out, run the real `Supervisor` and store against the dev Postgres with a worker that posts `[20, { state: "banned", reason: "IS_BANNED" }]`, on an account the signed-in player already lists. The bell counts it at once, and the API logs its `bot_alerts` email 30 to 45 seconds later.
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
