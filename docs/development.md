# Development

Needs Node 22.18 or newer and pnpm 11. Docker is not needed for development or tests.

```sh
pnpm install
pnpm dev            # Postgres, migrations, demo data, API, player and admin apps
pnpm dev --runner   # the same, plus the bot runner (it will log real accounts in)
```

`pnpm dev` starts a throwaway Postgres unless `DATABASE_URL` is set. It prints the URLs and the demo logins: player `demo`, admin `admin`, both with password `demo-password` and a confirmed email. Without `--runner`, nothing contacts the game.

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
