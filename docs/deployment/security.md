# Security model

## Who can see what

| Data | Players | Admins | API process / database | Runner |
|---|---|---|---|---|
| Their own game accounts, status, logs | yes | yes (all accounts, no passwords) | yes | yes |
| Other players' accounts | no | yes | yes | yes |
| Game passwords | write-only | no | sealed bytes only | yes (opens them to log in) |
| Panel passwords | no | no | argon2id hashes | no |
| Session tokens | their own cookie | their own cookie | SHA-256 only | no |
| Admin authenticator secrets | no | shown once, at setup | encrypted bytes, and the key that opens them | no |
| Admin recovery codes | no | shown once | SHA-256 only | no |

Game passwords are sealed with an X25519 public key (HKDF-SHA256, AES-256-GCM). The API holds only the public key; only the runner holds `SEAL_PRIVATE_KEY`. A stolen database or API host does not reveal game passwords. A stolen runner host plus database does: protect the runner host and the key as the most sensitive parts of the deployment.

## Admin two-factor sign-in

A stolen admin password alone does not open the admin app. Every admin sign-in takes the password and then a second factor: a 6-digit code from an authenticator app (TOTP, RFC 6238), or a recovery code. The player app is unchanged, so an admin signs in there with the password alone and gets a player session.

- **First sign-in.** An admin with no authenticator is shown a QR code and a setup key after the password. The first correct code turns two-factor sign-in on and shows 10 recovery codes once.
- **The password step starts no session.** It sets a 5-minute `gge_admin_mfa` cookie (`HttpOnly`, `SameSite=Strict`, sent only to `/admin/rpc`) that the code step must present. A new password step replaces the older one.
- **Wrong codes.** 5 wrong codes end the attempt and the admin starts again from the password. Across attempts, 10 wrong codes in 15 minutes lock that admin's code step until the window ends. Someone who knows the password can use this cap to keep the admin out, so treat a locked code step as a sign that the password leaked.
- **Replay.** A code works once. The API accepts the codes for the previous, current and next 30-second step, then refuses that step and every older one.
- **Recovery codes.** Each works once. Using one writes `auth.recovery_code.used` to the audit log and emails the admin. An admin makes a new set under **Settings** in the admin app with a current code; the old set stops working.
- **Storage.** Secrets are encrypted with `TOTP_ENCRYPTION_KEY` (AES-256-GCM, bound to the user ID). Unlike game passwords, the API can open them, because it must check codes. A stolen database without the key reveals no secret. Recovery codes are stored as SHA-256 hashes.

### Reset an admin who lost their authenticator

If another admin can sign in, they click **Reset 2FA** on the **Users** page. Otherwise, run the command on the host:

```sh
docker compose --env-file infra/.env -f infra/docker-compose.yml exec api \
  node apps/api/src/cli/reset-2fa.ts --username yourname
```

Both delete the admin's authenticator and recovery codes and end their admin sessions. Their player sessions stay. At the next admin sign-in they set up a new authenticator. Both write `admin.user.totp_reset` to the audit log; the command's entry has no actor and `via: cli`. An admin can't reset their own in the app.

The reset removes the second factor, so the password is all that guards the account until the admin enrolls again. Have them sign in straight away.

### Upgrading from a version without two-factor sign-in

Set `TOTP_ENCRYPTION_KEY` before you deploy; the API refuses to start without it. The migration signs every admin out once. Each admin then signs in with the password and sets up an authenticator. Until an admin does, their password alone is enough to enroll, so have every admin sign in soon after the upgrade.

## Requests

- Two separate apps on separate origins (`app.` and `admin.`), with separate session cookies (`gge_session`, `gge_admin`). A player session never authenticates an admin call.
- Cookies are `HttpOnly`, `Secure`, `SameSite=Lax`. Every RPC call must carry an `Origin` from the allowlist (`CLIENT_ORIGINS` or `ADMIN_ORIGINS`) or it gets 403.
- Sign-in answers a wrong password and an unknown user identically, in the same time. Every attempt counts toward a per-IP cap (100 per 15 minutes). Only failed attempts count toward the per-username caps: 10 per 15 minutes from one IP, and 50 per 15 minutes across all IPs. A stranger guessing from their own IP can't lock the owner out; a guesser spread over many IPs can, for up to 15 minutes. A successful sign-in clears that IP's failures.
- Sign-in accepts a username or an email; usernames can't contain `@`, so the two never collide. An email matches the way sign-up uniqueness does (case, and dots and `+tags` for Gmail and similar providers), so any spelling of the address works.
- A password change in Settings has its own cap on wrong current passwords (10 per 15 minutes per account), so failed sign-ins never block it.
- Sign-up is open and always creates a player, never an admin. Every new address must be verified by link. Until it is, the player can sign in, resend the link and change the address, but every account, bot, server and plugin procedure answers `FORBIDDEN`. Sign-up is rate-limited per IP. Admins are made with `create-admin` or the admin app's role toggle.
- Email links carry a random 32-byte token. Only its SHA-256 is stored, a token works once, a new request replaces older ones, and it dies if the account's email changed after it was issued. Verification links last 24 hours, reset links 1 hour.
- Password reset is offered only for verified addresses and answers the same for every address. Requests are throttled per IP and per address (3 per 15 minutes). A reset, or a password change in Settings, ends sessions (all of them for a reset, all but the current one for a change) and sends a notice email. Admins reset through the player app's forgot-password page.
- Users can add an email only while they have none and can't change it afterwards.
- Every account query is scoped to the signed-in owner. Integration tests break the ownership filter and the Origin check on purpose to prove they are enforced.
- Input is validated by the contract's Zod schemas; output is shaped by them too, so fields the contract doesn't declare are never sent.
- Disabling a user or changing their role ends their sessions at once; disabling also stops their bots. A demoted admin keeps their authenticator, so promoting them again doesn't ask them to enroll.
- Every admin action and every account start, stop, create, update and remove is written to the audit log with its actor.

## Live updates

The browser gets status changes and log lines from Centrifugo over a websocket at `/connection/websocket`. The socket carries no cookie. Two kinds of token, both signed by the API with `CENTRIFUGO_TOKEN_SECRET` (HS256) and valid for 15 minutes, decide what a socket can see.

- **Connection token** (`realtime.connectionToken`). It names the signed-in player. Centrifugo lets a socket subscribe to `personal:user#<userId>` only when the ID matches the token, so a player can't read another player's status events.
- **Subscription token** (`realtime.subscriptionToken`). It names one `bot:<accountId>` channel, which carries that account's log lines. The API signs one only for the account's owner. It answers `NOT_FOUND` for another player's account exactly as it does for an account that doesn't exist.
- Both need a signed-in player with a verified email. The app asks for a new token before the old one expires, and a session that has ended doesn't get one.
- **A session that ends loses its sockets at once.** Sign-out, a password change or reset, an admin's **Revoke sessions**, a role change, and disabling a user each queue a `disconnect` for that user in the same transaction. Centrifugo closes every socket the user has. A browser that is still signed in reconnects with a new token. A browser whose session ended gets `UNAUTHORIZED`, stops, and shows the sign-in page.
- If Centrifugo is down when the session ends, the `disconnect` waits in the outbox. If Centrifugo stays down for more than an hour, the runner deletes the row. The browser can then reconnect with the token it already has until that token expires, at most 15 minutes after the API signed it.
- Centrifugo's HTTP API and admin UI are off. The only way to publish is a row in `centrifugo_outbox`, so publishing needs database access.

## Host

- Only Caddy publishes ports (80, 443). Postgres, Prometheus, the runner and the metrics endpoints are on the internal Compose network.
- Caddy sets HSTS, `X-Content-Type-Options`, `X-Frame-Options: DENY`, a strict referrer policy and a permissions policy.
- Containers run as the unprivileged `node` user.
- `.dockerignore` keeps `user.db`, `ggeConfig.json`, `credentials/` and local data out of images.

## Known limits

- Discord: when `DISCORD_TOKEN` is set, each bot opens its own Discord connection with the same token. A single shared client is planned.
- Rate limits are in memory in the single API process; running two API replicas would split them, and a restart clears them.
- An admin who never signed in after two-factor sign-in arrived, or who was just reset, is guarded by the password alone until they enroll.
- There is no automatic re-seal for key rotation ([backup-restore.md](backup-restore.md)).
- Botting breaks Goodgame Empire's terms of service. Accounts can be banned; the runner stops a banned account and never retries it on its own.
