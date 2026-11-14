# Backups and restore

## What to back up

| What | Where | Why |
|---|---|---|
| The database | `backups` volume nightly, plus Google Drive | Users, accounts, settings, history |
| `BACKUP_PASSPHRASE` | password manager | Decrypts the copies on Google Drive. Without it they are unreadable. |
| `SEAL_PRIVATE_KEY` | `infra/.env` | Opens every stored game password. Without it, restored accounts can't log in and every player must re-enter their game password. |
| `infra/.env` | host | Every other secret |

Keep the private key apart from the database dumps (a password manager, or a separate encrypted store). Someone with both can read every game password.

## Nightly dumps

The `backup` service runs `pg_dump --format=custom` at 03:00 UTC into the `backups` volume and deletes dumps older than `BACKUP_KEEP_DAYS` (default 14). A dump on the same disk as the database is not a backup: turn on the Google Drive copies below.

Manual dump at any time:

```sh
dc exec backup pg_dump -h postgres -U gge -d gge --format=custom --file=/backups/manual.dump
```

(`dc` = `docker compose --env-file infra/.env -f infra/docker-compose.yml`)

## Off-site copies on Google Drive

With `GDRIVE_TOKEN` set, the `backup` service encrypts each nightly dump with `BACKUP_PASSPHRASE` and uploads it to the `gge-backups` folder of your Drive:

- `daily/` holds every nightly dump for `BACKUP_KEEP_DAYS` days (default 14).
- `monthly/` holds the first dump of each month for `BACKUP_KEEP_MONTHS` months (default 12). A server that was down on the 1st uploads its monthly copy on its next dump.

Files keep readable names (`gge-<time>.dump.bin`); their contents are encrypted. Deleted copies go to Drive's trash. A failed upload is logged as `off-site upload failed` and retried the next night; the local dump is kept either way.

### One-time setup (personal Google account)

1. In the [Google Cloud console](https://console.cloud.google.com), create a project and enable the **Google Drive API**.
2. Configure the OAuth consent screen: audience **External**, add only the `.../auth/drive.file` scope (rclone then sees only files it created), then **Publish app** so its status is **In production**. While an app is in Testing its grants expire after 7 days, and uploads stop a week after setup. `drive.file` is not a sensitive scope, so publishing needs no review; you'll click through an "unverified app" warning once.
3. Create an OAuth client of type **Desktop app** and note its client ID and secret.
4. On a computer with a browser and [rclone](https://rclone.org/install/):
   ```sh
   rclone config create gdrive drive client_id=<id> client_secret=<secret> scope=drive.file
   rclone config show gdrive     # copy the JSON after "token = "
   ```
5. Generate a passphrase with `openssl rand -hex 32` and store it in your password manager, apart from `SEAL_PRIVATE_KEY`.
6. Set `GDRIVE_CLIENT_ID`, `GDRIVE_CLIENT_SECRET`, `GDRIVE_TOKEN='<token JSON>'` and `BACKUP_PASSPHRASE` in `infra/.env` (or Dokploy's Environment tab) and redeploy. The service dumps once when it starts: `dc logs backup` should show `backup uploaded`, and the files appear in Drive under `gge-backups/`.

Check the log again the next morning and a week later; that confirms the token keeps refreshing and the app isn't stuck in Testing.

## Restore

1. Stop everything that writes: `dc stop api runner`.
   To restore from Google Drive, first copy a dump into the volume (`offsite.sh` is rclone with the passphrase applied):
   ```sh
   dc exec backup bash /backup/offsite.sh lsf offsite:daily      # or offsite:monthly
   dc exec backup bash /backup/offsite.sh copy offsite:daily/<file>.dump /backups/
   ```
2. Restore into a clean database:
   ```sh
   dc exec postgres dropdb -U gge gge
   dc exec postgres createdb -U gge gge
   dc exec backup pg_restore -h postgres -U gge -d gge --no-owner /backups/<file>.dump
   ```
3. Make sure `infra/.env` has the `SEAL_PRIVATE_KEY` that was in use when the dump was taken.
4. Start: `dc up -d`. `migrate` brings the schema up to the running version.

### With only the password manager

If the server and the Google Cloud project are both gone, download the `.dump.bin` file from the Drive web interface and decrypt it on any machine with rclone:

```sh
rclone copy ":crypt,remote=/path/to/downloads,password=$(rclone obscure '<BACKUP_PASSPHRASE>'),filename_encryption=off:" ./restored
```

`./restored` then holds the plain `.dump` for `pg_restore`.

## Restore drill

Do this once after the first deploy and again every few months, on a spare machine or a throwaway VM:

1. Deploy from a clean checkout with a copy of `infra/.env`.
2. Restore last night's dump from Google Drive as above, not from the old server's volume. That proves the off-site copy works.
3. Sign in to the admin app; check user and account counts match production.
4. Start one bot you own and watch it reach Running. That proves the private key matches the stored passwords.
5. Tear the machine down.

Write the date and result somewhere your team will see it.

## Rotating the key pair

There is no automatic re-seal yet. To rotate: generate a new pair, then for each account have its owner re-enter the game password (it is sealed with whichever public key the API holds), or write a one-off job that opens each `password_sealed` with the old private key and seals it with the new public key in one transaction. Keep the old private key until every account has been re-sealed.
