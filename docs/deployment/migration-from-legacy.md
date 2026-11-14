# Moving from the legacy bot

The legacy bot is the single `main.js` process with its panel, `user.db` and `ggeConfig.json`. Moving copies its users, game accounts and plugin settings into the new database. Nothing logs in during the move: every imported account arrives stopped.

## Before you start

- Deploy the new stack ([README.md](README.md)) and let the runner start once, so the servers table is filled. Check the admin overview shows a runner heartbeat.
- Tell your players the panel moves to `https://app.<domain>`, that their username and password stay the same, and that they press Start on each account themselves once moved.

## Steps

1. Stop the legacy bot so `user.db` is not being written and no account is logged in twice:
   ```sh
   # wherever it runs
   pkill -f "node .*main.js"   # or stop its service
   ```
2. Copy `user.db` to the new host, into the repository folder.
3. Run the importer inside the stack. The `api` service already has `DATABASE_URL` and the public key it needs:
   ```sh
   dc run --rm --no-deps -v "$PWD/user.db:/import/user.db:ro" api \
     node tools/import-sqlite/cli.ts --db /import/user.db
   ```
   (`dc` = `docker compose --env-file infra/.env -f infra/docker-compose.yml`)
4. Read the report it prints:
   ```
   users: 12 imported, 0 already there, 0 skipped
   game accounts: 30 imported, 0 already there, 2 skipped
     skipped account #41 Ironhold: duplicate of an imported account
     dropped setting Ravenmoor: plugin attackStormFortsOld
   ```
   | Line | Meaning |
   |---|---|
   | skipped user … username already used | Someone signed up on the new stack with that name first. Rename one and re-run. |
   | skipped account … owner not found | The account's panel user no longer exists in `user.db`. |
   | skipped account … unknown server N | Server N is not in the current server list. |
   | skipped account … duplicate of an imported account | Legacy allowed the same game account under two panel users; the first one was kept. |
   | dropped setting … plugin X / X.option | The plugin or option no longer exists, or its saved value was invalid. Defaults apply. |
5. Sign in to the admin app and check the counts. Players sign in with their old credentials; their password hash is upgraded on that first sign-in.

The importer can run again safely: rows already imported (matched by their legacy ids) are left alone.

## Before upgrading a stack that already has users

Migration `0007_canonical_email` makes one mailbox one account: `a.b+x@gmail.com` and `ab@googlemail.com` are the same address. It fails, and rolls back, if two existing users already collide under that rule. Before deploying, open `psql` on the production database, run the `CREATE FUNCTION canonical_email` statement from `packages/db/drizzle/0007_canonical_email.sql` with the name changed to `pg_temp.canonical_email` (it disappears when the session ends), then run:

```sql
select pg_temp.canonical_email(email) as mailbox, array_agg(username) as users
from users where email is not null
group by 1 having count(*) > 1;
```

Resolve every row it returns by clearing or changing one of the emails.

Players imported from the legacy bot start with a limit of one bot (`users.max_bots`). Imported players who already own more keep them; they just can't add more. Raise a limit on the admin Users page.

## What does not move

- `ggeConfig.json`: its settings are now environment variables ([env.md](env.md)). `signupToken` is gone; anyone can sign up, and must confirm an email before running bots.
- Bot logs and in-memory state.
- Discord guild links move; Discord channel choices move with each account's plugin settings.

## After the move

Keep `user.db` until every player has signed in once and you are sure nothing is missing, then delete it: it holds every game password in plain text.
