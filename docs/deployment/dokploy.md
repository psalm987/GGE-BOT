# Deploying with Dokploy

Use this instead of [README.md](README.md) when the server already runs [Dokploy](https://dokploy.com). The stack is the same; the differences are that Dokploy's Traefik owns ports 80/443 and issues the certificates, settings go in Dokploy's Environment tab, and domains are assigned in its Domains tab. The compose file for this is `infra/docker-compose.dokploy.yml`.

Read the warnings at the top of [README.md](README.md) first: botting breaks the game's terms, and the server holds other players' game passwords.

## Before you start

- Dokploy installed on the server, reachable at its dashboard.
- Three DNS records pointing at the server: `app.<domain>`, `admin.<domain>` and `grafana.<domain>`.
- The repository on a Git provider Dokploy can read (GitHub, GitLab, Gitea or a plain Git URL), with the branch you want to deploy.
- A machine with Node 22.18+ and pnpm to generate the key pair (your laptop is fine).

## 1. Generate the game-password key pair

On your machine, in a checkout of the repository:

```sh
pnpm install
cd tools/dev && node keygen.ts
```

It prints `SEAL_PUBLIC_KEY=…` and `SEAL_PRIVATE_KEY=…`. Keep the private key somewhere safe and separate from backups; without it no stored game password can be opened ([backup-restore.md](backup-restore.md)).

## 2. Create the compose service

In Dokploy: **Projects → Create Project**, then inside it **Create Service → Compose**.

| Field | Value |
|---|---|
| Compose type | Docker Compose (not Stack: Stack mode can't build images) |
| Provider | Your Git provider, repository and branch |
| Compose Path | `./infra/docker-compose.dokploy.yml` |

Leave **Isolated Deployments** off. The compose file already puts `web` and `grafana` on `dokploy-network` and keeps every service on its own default network.

## 3. Environment

Open the **Environment** tab and paste, filling every empty value. Dokploy writes this to `infra/.env` beside the compose file, where the compose file reads it.

```env
DOMAIN=example.com
GGE_VERSION=latest
POSTGRES_PASSWORD=
GRAFANA_ADMIN_PASSWORD=
SEAL_PUBLIC_KEY=
SEAL_PRIVATE_KEY=
MAX_ACCOUNTS=50
START_GAP_MS=2000
GAME_CLIENT_VERSION=
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
BACKUP_KEEP_DAYS=14
```

Generate the two passwords with `openssl rand -base64 32`. Every variable is explained in [env.md](env.md); `ACME_EMAIL` is not needed here because Dokploy handles certificates.

## 4. Domains

Open the **Domains** tab and add three, each with HTTPS on and the Let's Encrypt certificate:

| Host | Path | Service | Container port |
|---|---|---|---|
| `app.<domain>` | `/` | `web` | 80 |
| `admin.<domain>` | `/` | `web` | 80 |
| `grafana.<domain>` | `/` | `grafana` | 3000 |

The hosts must match `DOMAIN`: the API only accepts calls from `https://app.<DOMAIN>` and `https://admin.<DOMAIN>`, and Caddy inside `web` picks the app by host name.

## 5. Deploy

Press **Deploy** and follow the logs. The first build takes several minutes. Expect:

- `migrate` prints `migrations applied` and exits 0.
- `api` becomes healthy.
- `runner` logs `runner latest started` after downloading the game's data.

## 6. First admin

Open the **api** container's terminal (in the service, **Docker** or **Logs → Terminal**, depending on your Dokploy version) and run:

```sh
GGE_ADMIN_PASSWORD='a long password' node apps/api/src/cli/create-admin.ts --username yourname
```

Sign in at `https://admin.<domain>`, create an invite, and open its signup link to make a player account at `https://app.<domain>`.

## Check it

| Check | Expect |
|---|---|
| `https://app.<domain>/healthz` | `{"ok":true}` |
| Admin app, Overview | Runner heartbeat a few seconds old |
| `https://grafana.<domain>` | Sign in as `admin` / `GRAFANA_ADMIN_PASSWORD`; the GGE folder has three dashboards |

## Operating it

- **Upgrades:** push to the branch and press Deploy (or turn on Auto Deploy). `migrate` runs first; the runner gets 60 seconds to stop its bots, and the new one starts them again spaced `START_GAP_MS` apart. Take a dump first when a release adds migrations ([operations.md](operations.md)).
- **One runner only.** Don't add replicas to `runner`; a second copy exits on purpose.
- **Backups:** the `backup` service writes nightly dumps to the `backups` volume. Copy them off the server, for example with a Dokploy Volume Backup of that volume to S3. Restore steps are in [backup-restore.md](backup-restore.md); run them from the `backup` container's terminal.
- **Moving from the legacy bot:** [migration-from-legacy.md](migration-from-legacy.md). Copy `user.db` into the `api` container (or mount it) and run the importer from its terminal with `node tools/import-sqlite/cli.ts --db /path/to/user.db`.

## When something's wrong

| Symptom | Likely cause |
|---|---|
| Traefik 404 on a domain | The domain points at the wrong service or port, or the deploy hasn't finished |
| Bad gateway (502) | `web` or `grafana` isn't on `dokploy-network`; redeploy with the compose file unchanged, and keep Isolated Deployments off |
| App loads but sign-in says "Origin not allowed" | `DOMAIN` doesn't match the hosts in the Domains tab |
| Signed in, then signed out on reload | The site is being opened over plain HTTP; session cookies are Secure-only |
| Deploy fails with "set … in Dokploy's Environment tab" | A required variable is empty |
