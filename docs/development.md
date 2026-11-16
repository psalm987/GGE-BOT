# Development

Needs Node 22.18 or newer and pnpm 11. Docker is not needed for development or tests.

```sh
pnpm install
pnpm dev            # Postgres, migrations, demo data, API, player and admin apps
pnpm dev --runner   # the same, plus the bot runner (it will log real accounts in)
```

`pnpm dev` starts a throwaway Postgres unless `DATABASE_URL` is set. It prints the URLs and the demo logins: player `demo`, admin `admin`, both with password `demo-password` and a confirmed email. Without `--runner`, nothing contacts the game.

## Live updates (Centrifugo)

`pnpm dev` also starts [Centrifugo](https://centrifugal.dev) when `CENTRIFUGO_BIN` names its binary or `centrifugo` is on `PATH`. Without it, `pnpm dev` prints one line that says so, and the API answers `NOT_IMPLEMENTED` to the `realtime` token calls. Use the release that `infra/Dockerfile` pins, v6.10.2, from the [Centrifugo releases page](https://github.com/centrifugal/centrifugo/releases).

With `CENTRIFUGO_BIN` set, `pnpm test` also runs `apps/runner/test/realtime-e2e.test.ts`, which sends a status change and a log line through a real Centrifugo to a websocket.

If another program holds port 3000, 5173, 5174 or 8000, set `GGE_DEV_PORT_SHIFT`. `GGE_DEV_PORT_SHIFT=10 pnpm dev` uses 3010, 5183, 5184 and 8010.

## Checks

| Command | Runs |
|---|---|
| `pnpm lint` | ESLint (`no-undef`) over the JavaScript |
| `pnpm typecheck` | `tsc` in every TypeScript package |
| `pnpm test` | Every package's Vitest suite. API, runner and importer tests start their own Postgres. |
| `pnpm test:formal` | The TLA+ model of the commander pool (needs Java 11+) |
| `pnpm check` | All of the above |

Integration tests look for a working local Postgres install (Homebrew kegs included) and run `initdb` into a temp folder. Set `TEST_DATABASE_URL` to use an existing database instead, as CI should; set `PG_BIN` to point at a specific Postgres `bin` folder.

## Conventions

- New packages are TypeScript run directly by Node's type stripping: no build step, `erasableSyntaxOnly`, imports with `.ts` extensions. The web apps build with Vite.
- The bot (`packages/bot-core`) stays JavaScript. Its tests load real modules with only the game connection stubbed (`test/harness/load.cjs`) or run the real `ggeBot.js` in a worker against a scripted socket (`test/harness/bot-session.cjs`).
- A verified bug gets a failing test first. A test proves the behaviour a caller sees, not the implementation.

## Upstream fixes

This is a hard fork of `darrenthebozz/GGE-BOT`; its layout no longer matches. To bring an upstream fix across, read the upstream commit, find the moved file (`plugins/x.js` is now `packages/bot-core/plugins/x.js`), write a failing test for the bug, then apply the fix by hand. `git diff -M <upstream-commit> -- plugins/x.js packages/bot-core/plugins/x.js` shows both sides.
