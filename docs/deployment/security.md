# Security model

## Who can see what

| Data | Players | Admins | API process / database | Runner |
|---|---|---|---|---|
| Their own game accounts, status, logs | yes | yes (all accounts, no passwords) | yes | yes |
| Other players' accounts | no | yes | yes | yes |
| Game passwords | write-only | no | sealed bytes only | yes (opens them to log in) |
| Panel passwords | no | no | argon2id hashes | no |
| Session tokens | their own cookie | their own cookie | SHA-256 only | no |

Game passwords are sealed with an X25519 public key (HKDF-SHA256, AES-256-GCM). The API holds only the public key; only the runner holds `SEAL_PRIVATE_KEY`. A stolen database or API host does not reveal game passwords. A stolen runner host plus database does: protect the runner host and the key as the most sensitive parts of the deployment.

## Requests

- Two separate apps on separate origins (`app.` and `admin.`), with separate session cookies (`gge_session`, `gge_admin`). A player session never authenticates an admin call.
- Cookies are `HttpOnly`, `Secure`, `SameSite=Lax`. Every RPC call must carry an `Origin` from the allowlist (`CLIENT_ORIGINS` or `ADMIN_ORIGINS`) or it gets 403.
- Sign-in answers a wrong password and an unknown user identically, in the same time, and is throttled per IP (100 per 15 minutes) and per username (10 per 15 minutes).
- Sign-up needs a single-use invite; invite codes are stored hashed and shown once.
- Every account query is scoped to the signed-in owner; the live event stream filters by ownership. Integration tests break the ownership filter and the Origin check on purpose to prove they are enforced.
- Input is validated by the contract's Zod schemas; output is shaped by them too, so fields the contract doesn't declare are never sent.
- Disabling a user or changing their role ends their sessions at once; disabling also stops their bots.
- Every admin action and every account start, stop, create, update and remove is written to the audit log with its actor.

## Host

- Only Caddy publishes ports (80, 443). Postgres, Prometheus, the runner and the metrics endpoints are on the internal Compose network.
- Caddy sets HSTS, `X-Content-Type-Options`, `X-Frame-Options: DENY`, a strict referrer policy and a permissions policy.
- Containers run as the unprivileged `node` user.
- `.dockerignore` keeps `user.db`, `ggeConfig.json`, `credentials/` and local data out of images.

## Known limits

- Discord: when `DISCORD_TOKEN` is set, each bot opens its own Discord connection with the same token. A single shared client is planned.
- Rate limits are in memory in the single API process; running two API replicas would split them.
- There is no automatic re-seal for key rotation ([backup-restore.md](backup-restore.md)).
- Botting breaks Goodgame Empire's terms of service. Accounts can be banned; the runner stops a banned account and never retries it on its own.
