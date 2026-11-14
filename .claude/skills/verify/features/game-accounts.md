# Game accounts

A signed-in user adds the Goodgame Empire accounts the bot will run, edits their password, server and event options later, and removes them. Each account is a row in the users table and a `SubUsers` row in `user.db`, owned by the panel login's `uuid`.

## Sub-features

- `acct-add` adds an account from the **+** dialog with username, password and server; it appears stopped.
- `acct-edit` changes password, server or the **OR/BTH** (external event) checkbox from the row's **Settings**; the username field is disabled when editing.
- `acct-keep-pass` saving **Settings** with an empty password keeps the stored password.
- `acct-remove` removes the ticked rows with **Remove**.
- `acct-select-all` ticks every row from the header checkbox (`select all entries`).
- `acct-isolation` a second panel login never sees the first login's accounts.

## How to get to it (user POV)

- Users table header **+** button opens the account dialog (new account).
- Row button **Settings** opens the same dialog prefilled.
- Row checkbox or header checkbox, then **Remove** in the last table row.
- Clicking the dark backdrop outside the dialog closes it without saving.

## Driving it with Playwright (drive.js)

Preconditions:

- `gge-verify doctor NAME` is healthy. drive.js signs up a fresh panel user automatically.

- **Add.** Run `node .claude/skills/verify/scripts/drive.js NAME add-account` (optionally `--game-name N --server ID`; ID is an `<instance value="...">` from the instance's `1.xml`, the dropdown is `#simple-select`, options are `li[data-value=ID]`). The row with that name appears; `db-after-add-account.json` has exactly one matching `SubUsers` row with `state: 0`. `ws-frames.log` shows the `[0,4,{...}]` AddUser frame and the `[0,1,[...]]` GetUsers refresh.
- **Remove.** Run `node .claude/skills/verify/scripts/drive.js NAME add-account remove-account`. The row detaches; `db-after-remove-account.json` has no row with that name; `ws-frames.log` shows `[0,3,[...]]` RemoveUser.
- **Edit, keep-pass, select-all, isolation.** Not scripted steps yet. Edit: open **Settings**, change the server, **Save**, and assert `SubUsers.server` changed and `pass` did not. Isolation: two browser contexts, two sign-ups, account added in one must not appear in the other's table or in its GetUsers frame.

## Gotchas

- The dialog has no validation: **Save** with an empty username or password still sends AddUser and creates a row. Don't treat a created row as proof the form validated anything.
- Adding an account never contacts the game; a fake password is fine. Starting it does (see [run-bot.md](run-bot.md)).
- The server dropdown lists only `<instance>`s from `1.xml` that have an `instanceLocaId`, plus a hard-coded `SP 3` (id 103). Its labels come from the GGE language file proxied through `/ggeProxyEmpire5`, so with that fetch failing the labels show raw keys.
- Account rows are matched by their row-header cell (the name). Two accounts with the same name under one login are allowed and make that match ambiguous; use unique names.
- The table re-renders on every GetUsers frame; re-query locators after any save instead of holding element handles.
