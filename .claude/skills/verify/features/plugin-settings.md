# Plugin settings

From a game account's **Settings** dialog, the user turns plugins on or off and edits each plugin's options (numbers, checkboxes, dropdowns, Discord channels, sliders, times). Saving stores them on the account. A stopped account just stores them; a running account gets them live (see [run-bot.md](run-bot.md)).

## Sub-features

- `plug-toggle` each non-forced plugin row has a **Start**/**Stop** button; forced plugins (`skips`, `attack`) show a disabled blank button and are always on.
- `plug-options` clicking a plugin's name shows its options under the list (only plugins that have options highlight).
- `plug-option-kinds` option widgets: `Text` text field, `Checkbox`, `Select` (Khan, Nomads), `Label` (section headings), `Time`, slider, and a Discord channel select (only with Discord configured).
- `plug-defaults` empty options are filled with the plugin's defaults when a bot starts, not when saving.
- `plug-column` the users table **Plugins** column lists enabled, non-forced plugins by label.
- `plug-hidden` hidden plugins (`commander`, `intervalTimer`, `misc`, `resourceSendStorm`) never appear in the list.

Plugins loaded with no Discord and no `plugins-extra`: Feast, Help requests, meadReplaceStorm, Sell stored equipment, Shutoff timer, Attack barrons (Burning Sands / Ever Winter Glacier / Fire Peaks / Great Empire), Berimond invasion, Fortresses (Burning Sands / Ever Winter Glacier / Fire Peaks), Khan, Nomads, Samurai, Storm forts, plus forced skips and attack.

## How to get to it (user POV)

- Users table row → **Settings** → plugins table (ARIA `plugins table`) in the dialog → **Save**.
- The **+** dialog for a new account has the same plugins table.

## Driving it with Playwright (drive.js)

Preconditions:

- `gge-verify doctor NAME` is healthy.

- **Toggle and save.** Run `node .claude/skills/verify/scripts/drive.js NAME edit-plugins`. It adds a stopped dummy account if needed, opens **Settings**, clicks the name of the first plugin with an enabled **Start** (Feast today) so its options render, clicks **Start**, and expects that row's button to read **Stop**, then **Save**. Proof: `db-before-edit-plugins.json` vs `db-after-edit-plugins.json` show exactly that plugin newly `{"state":true}` and the account still `state: 0`; `ws-frames.log` has the `[0,2,{...}]` SetUser frame; the Plugins column shows the label.
- **Edit an option value.** Not a scripted step yet. In the dialog, click `Feast`, fill the `Minimum food` text field (`getByLabel('Minimum food')`), **Save**, and assert the new value in `SubUsers.plugins.feast` from `gge-verify db NAME`.
- **Option kinds.** Khan (`Attack Khan`) has a `Select`; barons have `Label` + `Checkbox` + `Text`. Use `getByLabel(<option label>)` for text and checkbox; for a select, click the combobox then `getByRole('option', { name })`.

## Gotchas

- Read the plugin list from the panel or the GetUsers frame in `ws-frames.log`, not with `node -e "require('./plugins')"`: `plugins/intervalTimer.js` requires `../main.js`, so loading the plugins boots a second server in that directory (it dies on `EADDRINUSE` if the instance is up, or binds the port if not).
- The toggle writes into the dialog's copy of the account before **Save**. Assert on `user.db` after saving, not on what a reopened dialog shows.
- An option left at its default is not written on save; it is filled in by `main.js` when the bot starts. A saved account showing `{"state":true}` with no option keys is correct.
- `plugins/attack/attackStormForts.js` logs an `ENOENT ... ./plugins-extra/upgradeStormCargo.js` stack at startup without `plugins-extra`. It still loads; the trace in `server.log` is expected, not a launch failure.
- Discord plugins (`plugins/discord/*`) and the channel select only exist when `discordToken` and `discordClientId` are set. The verify instance leaves them blank, so those are unreachable here; report them as not covered, not as passing.
- Toggling a plugin on a **running** account restarts its worker (state change) or sends `SetPluginOptions` (option-only change). Neither can be seen without `start-bot`.
