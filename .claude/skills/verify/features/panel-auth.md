# Panel sign-up, sign-in and logout

A user creates a panel login with the server's sign-up token, signs in with it later, and logs out. The panel login owns a set of game accounts; nothing else in the panel works without it.

## Sub-features

- `auth-signup` creates a panel user from `signup.html` with username, password and the sign-up token, then lands on the users table.
- `auth-signup-bad-token` refuses sign-up with a wrong token and shows `Login failed`.
- `auth-gate` sends a visitor without a valid `uuid` cookie from `index.html` to `signin.html`.
- `auth-signin` signs in from `signin.html`; a wrong password shows `Invalid login details.`.
- `auth-remember` with **Remember password** ticked sets a one-year `uuid` cookie instead of a session cookie.
- `auth-logout` clears the cookie from the logout icon button in the table header and returns to `signin.html`.

## How to get to it (user POV)

- Open `http://127.0.0.1:PORT/` (redirects to `index.html`, then to `signin.html` when logged out).
- `signin.html` links to `signup.html` via **Sign Up** (and, misleadingly, **Forgot Password**).
- `signup.html` links back via **Login**.
- From the users table: the logout icon button, left of **+**.

## Driving it with Playwright (drive.js)

Preconditions:

- `gge-verify doctor NAME` is healthy. The instance's sign-up token is `verify`.

- **Sign up.** Run `node .claude/skills/verify/scripts/drive.js NAME signup`. It fills `#username`, `#password`, `#token` and clicks **Signup**. The page lands on `/index.html` with a `Name` column header; `db-after-signup.json` has a `Users` row with that username whose `uuid` equals the cookie.
- **Gate and sign in.** Run `node .claude/skills/verify/scripts/drive.js NAME signin`. With cookies cleared, `/index.html` redirects to `/signin.html`; a wrong password puts `Invalid login details.` in `#login-info-banner`; the right one lands on the table with the same `uuid`.
- **Bad token, remember, logout.** Not scripted steps yet. In a one-off Playwright script: on `signup.html` submit token `wrong` and expect `#login-info-banner` to read `Login failed` and no new `Users` row; on `signin.html` tick `#remember-password` and expect the `uuid` cookie to have an `expires` about a year out; on the table click the logout button (the header button containing the Logout icon, `getByRole('button').filter({ has: page.locator('[data-testid=LogoutIcon]') })`) and expect `/signin.html`.

## Gotchas

- Sign-up hashes with PBKDF2 at 600 000 iterations, so each sign-up/login takes about half a second of server CPU. Don't loop it.
- Logout writes `uuid=` (empty) rather than deleting the cookie. The WebSocket then answers `[2,0,{}]` (Unauthenticated, GetUUID) and the React app redirects; assert the redirect, not the cookie being absent.
- Usernames are `UNIQUE`; a duplicate sign-up gets `{r:1}` and shows `Login failed`, the same message as a bad token. Use a fresh username per run (drive.js does).
- **Forgot Password** links to `signup.html`. There is no password reset; that is the current behavior, not a broken journey.
