# Backups and restore

## What to back up

| What | Where | Why |
|---|---|---|
| The database | `backups` volume, nightly | Users, accounts, settings, history |
| `SEAL_PRIVATE_KEY` | `infra/.env` | Opens every stored game password. Without it, restored accounts can't log in and every player must re-enter their game password. |
| `infra/.env` | host | Every other secret |

Keep the private key apart from the database dumps (a password manager, or a separate encrypted store). Someone with both can read every game password.

## Nightly dumps

The `backup` service runs `pg_dump --format=custom` at 03:00 UTC into the `backups` volume and deletes dumps older than `BACKUP_KEEP_DAYS` (default 14). A dump on the same disk as the database is not a backup: copy them off the host, for example nightly with `rclone` or `restic` from the volume's path (`docker volume inspect gge_backups`).

Manual dump at any time:

```sh
dc exec backup pg_dump -h postgres -U gge -d gge --format=custom --file=/backups/manual.dump
```

(`dc` = `docker compose --env-file infra/.env -f infra/docker-compose.yml`)

## Restore

1. Stop everything that writes: `dc stop api runner`.
2. Restore into a clean database:
   ```sh
   dc exec postgres dropdb -U gge gge
   dc exec postgres createdb -U gge gge
   dc exec backup pg_restore -h postgres -U gge -d gge --no-owner /backups/<file>.dump
   ```
3. Make sure `infra/.env` has the `SEAL_PRIVATE_KEY` that was in use when the dump was taken.
4. Start: `dc up -d`. `migrate` brings the schema up to the running version.

## Restore drill

Do this once after the first deploy and again every few months, on a spare machine or a throwaway VM:

1. Deploy from a clean checkout with a copy of `infra/.env`.
2. Restore last night's dump as above.
3. Sign in to the admin app; check user and account counts match production.
4. Start one bot you own and watch it reach Running. That proves the private key matches the stored passwords.
5. Tear the machine down.

Write the date and result somewhere your team will see it.

## Rotating the key pair

There is no automatic re-seal yet. To rotate: generate a new pair, then for each account have its owner re-enter the game password (it is sealed with whichever public key the API holds), or write a one-off job that opens each `password_sealed` with the old private key and seals it with the new public key in one transaction. Keep the old private key until every account has been re-sealed.
