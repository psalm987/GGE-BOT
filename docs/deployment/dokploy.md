# Deploying with Dokploy

Use this instead of [README.md](README.md) when the server already runs [Dokploy](https://dokploy.com). The stack is the same; the differences are that Dokploy's Traefik owns ports 80/443 and issues the certificates, settings go in Dokploy's Environment tab, and domains are assigned in its Domains tab. The compose file for this is `infra/docker-compose.dokploy.yml`.

Read the warnings at the top of [README.md](README.md) first: botting breaks the game's terms, and the server holds other players' game passwords.

## Before you start

- Dokploy installed on the server, reachable at its dashboard.
- Four DNS records pointing at the server: `app.<domain>`, `admin.<domain>`, `docs.<domain>` and `grafana.<domain>`.
- The repository on a Git provider Dokploy can read (GitHub, GitLab, Gitea or a plain Git URL), with the branch you want to deploy.
- A machine with Node 22.18+ and pnpm to generate the key pair (your laptop is fine).

## 1. Generate the game-password key pair

On your machine, in a checkout of the repository:

```sh
pnpm install
cd tools/dev && node keygen.ts
```

It prints `SEAL_PUBLIC_KEY=…`, `SEAL_PRIVATE_KEY=…` and `TOTP_ENCRYPTION_KEY=…`. Keep the private key somewhere safe and separate from backups; without it no stored game password can be opened ([backup-restore.md](backup-restore.md)).

Generate `CENTRIFUGO_TOKEN_SECRET` with `openssl rand -hex 32`. `POSTGRES_PASSWORD` takes the same command.

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
TOTP_ENCRYPTION_KEY=
CENTRIFUGO_TOKEN_SECRET=
MAXMIND_ACCOUNT_ID=
MAXMIND_LICENSE_KEY=
PAYSTACK_SECRET_KEY=
SUPPORT_EMAIL=
MAX_ACCOUNTS=50
START_GAP_MS=2000
GAME_CLIENT_VERSION=
DISCORD_TOKEN=
BACKUP_KEEP_DAYS=14
GDRIVE_CLIENT_ID=
GDRIVE_CLIENT_SECRET=
GDRIVE_TOKEN=
BACKUP_PASSPHRASE=
BACKUP_KEEP_MONTHS=12
```

The `GDRIVE_*` and `BACKUP_PASSPHRASE` lines turn on encrypted copies to Google Drive; leave them empty to start, and follow [backup-restore.md](backup-restore.md#off-site-copies-on-google-drive) to fill them.

The Contact form on the docs site mails `SUPPORT_EMAIL`. It needs that variable and a working `RESEND_API_KEY` with a verified `EMAIL_FROM` domain; without either the form tells visitors contact is unavailable.

Generate the two passwords with `openssl rand -hex 32`. Every variable is explained in [env.md](env.md); `ACME_EMAIL` is not needed here because Dokploy handles certificates.

## 4. Domains

Open the **Domains** tab and add four, each with HTTPS on and the Let's Encrypt certificate:

| Host | Path | Service | Container port |
|---|---|---|---|
| `app.<domain>` | `/` | `web` | 80 |
| `admin.<domain>` | `/` | `web` | 80 |
| `docs.<domain>` | `/` | `web` | 80 |
| `grafana.<domain>` | `/` | `grafana` | 3000 |

The hosts must match `DOMAIN`: the API only accepts calls from `https://app.<DOMAIN>` and `https://admin.<DOMAIN>`, and Caddy inside `web` picks the app, or the docs, by host name. The docs are built into `web` on every deploy, so they always describe the release that is running. Their links and sitemap name `docs.neisesolutions.com` (`apps/docs/astro.config.mjs`), so on another domain change `site` there and `SITE_URL` in `apps/docs/src/seo/jsonld.ts`.

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

Sign in at `https://admin.<domain>`. The first sign-in asks you to set up an authenticator app and shows your recovery codes once ([security.md](security.md#admin-two-factor-sign-in)). Players sign up themselves at `https://app.<domain>` and can run bots once they confirm their email.

## Check it

| Check | Expect |
|---|---|
| `https://app.<domain>/healthz` | `{"ok":true}` |
| `https://docs.<domain>` | The docs home page |
| Admin app, Overview | Runner heartbeat a few seconds old |
| `https://grafana.<domain>` | Sign in as `admin` / `GRAFANA_ADMIN_PASSWORD`; the GGE folder has three dashboards |

## IP language detection

With the language set to "Automatic", the apps pick a language from the visitor's country, then from their browser's language. The `geoip` service answers the country lookup from MaxMind's free GeoLite2-Country database. Without it, everything still works and the browser's language decides.

1. Create a free account at maxmind.com and sign in to the portal.
2. Under **Manage license keys**, generate a key. Copy it now, because MaxMind shows it once. Your account ID is on the same page.
3. Put both in the Environment tab as `MAXMIND_ACCOUNT_ID` and `MAXMIND_LICENSE_KEY`, then deploy.

The service downloads the database at first start and checks for a new one every 24 hours. It keeps the file in the `geoip-db` volume. It has no domain and is not on `dokploy-network`; only the API reaches it, at `http://geoip:8080`. To check it, open the service's terminal in Dokploy or run `docker compose logs geoip`. Empty or wrong credentials show as a failed download in that log, and the service may restart repeatedly. The apps are not affected.

The `api` metric `geoip_lookups_total{result="ip"|"none"|"skipped"|"error"}` shows whether lookups succeed. A steady stream of `skipped` means the API sees private addresses (see below).

MaxMind's licence asks apps to credit the data. The player app's Settings page does: "Automatic uses GeoLite2 data created by MaxMind."

**Behind Cloudflare.** Traefik does not trust Cloudflare, so it replaces `X-Forwarded-For` with the Cloudflare edge's address. Caddy inside `web` therefore takes the visitor's address from Cloudflare's `CF-Connecting-IP` header, and passes only that address to the API (`infra/Caddyfile.dokploy`). Without Cloudflare, the header is absent and Caddy uses `X-Forwarded-For` from Traefik. To check, call `i18n.detect` from a browser and compare `country` with your own: `curl -s -X POST https://app.<domain>/rpc/i18n/detect -H 'origin: https://app.<domain>' -H 'content-type: application/json' -d '{"json":{}}'`.

Anyone who reaches the server's IP directly, without passing through Cloudflare, can send a forged `CF-Connecting-IP`. The forged address then sets their language and the key of their per-IP rate limits. To prevent this, let only [Cloudflare's IP ranges](https://www.cloudflare.com/ips/) reach ports 80 and 443, with the host firewall or your provider's firewall.

## Paystack

Players pay for plans through Paystack. Until an admin presses **Go live** on the admin app's **Billing** page, nobody can pay and every player keeps the free limit. These steps get Paystack ready for that switch.

1. Create a business account at paystack.com. Every account has two secret keys. A test key (`sk_test_…`) takes only Paystack's test cards and moves no money. A live key (`sk_live_…`) charges real cards, and works once Paystack has approved the business.
2. In the Paystack dashboard, open **Settings → API Keys & Webhooks**. Copy the test secret key into the Environment tab as `PAYSTACK_SECRET_KEY`.
3. On the same page, set the test webhook URL to `https://app.<domain>/webhooks/paystack`. Paystack signs every event with the secret key, and the API refuses an event whose signature doesn't match ([security.md](security.md#payments)).
4. Deploy.

**Currencies.** Paystack charges in GHS, KES, NGN, ZAR and USD only, and each package has one price in one of them. Paystack has no EUR, so price packages for European players in USD. Ask Paystack to turn on USD for the merchant account first, because a USD charge fails without it.

### Go live

1. Set `PAYSTACK_SECRET_KEY` and deploy, as above.
2. On the **Billing** page, give each package you sell a price and a currency. A package without a price isn't sold online.
3. Sign in to the player app as an admin and buy a package with one of Paystack's test cards. An admin can pay before billing is live; a player can't. Under **Billing → Purchases**, check that the purchase is paid and delivered.
4. Put the live secret key in `PAYSTACK_SECRET_KEY`, set the live webhook URL to the same address, and deploy. Don't go live on a test key: players could then pay with test cards.
5. Press **Go live**.

To stop taking payments, press **Back to free** on the same page. A payment that was already started is still delivered when Paystack confirms it.

## Operating it

- **Upgrades:** push to the branch and press Deploy (or turn on Auto Deploy). `migrate` runs first; the runner gets 60 seconds to stop its bots, and the new one starts them again spaced `START_GAP_MS` apart. Take a dump first when a release adds migrations ([operations.md](operations.md)).
- **One runner only.** Don't add replicas to `runner`; a second copy exits on purpose.
- **Backups:** the `backup` service writes nightly dumps to the `backups` volume and, once the `GDRIVE_*` variables are set, copies each one, encrypted, to Google Drive ([backup-restore.md](backup-restore.md#off-site-copies-on-google-drive)). Restore steps are in [backup-restore.md](backup-restore.md); run them from the `backup` container's terminal.
- **Moving from the legacy bot:** [migration-from-legacy.md](migration-from-legacy.md). Copy `user.db` into the `api` container (or mount it) and run the importer from its terminal with `node tools/import-sqlite/cli.ts --db /path/to/user.db`.

## When something's wrong

| Symptom | Likely cause |
|---|---|
| Traefik 404 on a domain | The domain points at the wrong service or port, or the deploy hasn't finished |
| Bad gateway (502) | `web` or `grafana` isn't on `dokploy-network`; redeploy with the compose file unchanged, and keep Isolated Deployments off |
| App loads but sign-in says "Origin not allowed" | `DOMAIN` doesn't match the hosts in the Domains tab |
| Signed in, then signed out on reload | The site is being opened over plain HTTP; session cookies are Secure-only |
| Deploy fails with "set … in Dokploy's Environment tab" | A required variable is empty |
| A Paystack payment went through, but the purchase stays pending until the buyer comes back to the app | Paystack's webhook URL for the key in use (test or live) isn't `https://app.<domain>/webhooks/paystack` |
