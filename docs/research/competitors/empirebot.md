# EmpireBot (https://empirebot.win/) — competitive research

Explored 2026-11-16 with a disposable account. No Goodgame Empire account was linked. Nothing was started, saved, or changed.

## Summary
- **What it is:** a small, Italian-language, hosted (cloud) GGE bot service. The marketing site is a one-page placeholder: "EMPIREBOT — AUTOMAZIONE PER IL TUO IMPERO — Il sito è in arrivo" ("site coming soon"). Its only link is "ENTRA NEL PANNELLO", which goes to https://panel.empirebot.win/.
- **How it runs:** a hosted cloud bot. You give the panel your **GGE username and password plus a server**, and it logs into the game for you ("Collega castello" = link castle). There is no extension or desktop client.
- **Scale:** the verification token's JWT payload carried `uid: 13`, so the service probably has about 13 registered users. It looks like a very early or private operation.
- **Pricing:** there is no public pricing page.
  - Free trial: **4 days, which start when you link your first castle** ("collega il tuo primo castello per attivare 4 giorni gratis").
  - Banner: "Dal 1° novembre 2026 l'accesso ha una scadenza … Per estenderlo contattaci." Since 1 Nov 2026, access expires, and you extend it by contacting the operator. Billing is manual and has no self-serve checkout. Paid tiers and prices are not published.
- **Public docs:** there are no docs, FAQ, changelog, Discord, YouTube or socials linked anywhere. `/pricing`, `/docs`, `/faq` and `/sitemap.xml` all return 404 on both hosts. A web search found nothing about this product.

## Feature inventory
| Category | Feature | Options seen | Free/Paid | Evidence |
|---|---|---|---|---|
| Account/billing | Email + password sign-up | Email, Password, Conferma password; min 8 characters (from the change-password form) | Free | Observed in UI |
| Account/billing | Email verification | A link email from no-reply@empirebot.win; a JWT link that expires about 48h after issue. Until verified, the panel shows "non puoi collegare castelli" (you cannot link castles) and a "Rinvia email" (resend) button | Free | Observed |
| Account/billing | Plan badge in header | "PROVA GRATUITA" (free trial) | — | Observed |
| Account/billing | Trial / expiry | 4-day trial from the first castle link. Remaining days are shown on the account page. Extension is manual ("contattaci") | Trial free; extension paid (advertised, not verified) | Observed banner text |
| Account/billing | Change password | Password attuale (current), Nuova password (min 8), Ripeti nuova password, plus "Salva nuova password" and "Annulla" buttons | Free | Observed (opened only, not submitted) |
| Account/billing | Logout | "Esci" | Free | Observed (not clicked) |
| Multi-account | "I tuoi castelli" list | Multiple castles per panel account ("+ Aggiungi castello"; "collega il tuo primo castello" implies several). Per-castle limits are unknown | Unknown | Observed |
| Account linking | Add castle form | **Server** dropdown (39 entries below), **Nome castello (username GGE)** (placeholder "es. Player85"), **Password**, plus "Collega castello" and "Annulla" buttons | Free trial | Observed (form opened, not submitted) |
| Servers | Supported GGE zones | AE EmpireEx_33, ARAB _35, ASIA _36, AU _22, BG _16, BR _20, CN _27, CZ _4, DE _2, EG _34, ES _8, ES _38, FR _3, GB _19, GR _28, HANT _37, HIS _25, HU _12, HU _17, IN _26, INTERNATIONAL EmpireEx, INTERNATIONAL _7, INTERNATIONAL _43, IT _9, JP _24, KR _23, LT _29, NL _11, PL _5, PT _6, RO _15, RU _14, SA _32, SK _18, SKN _13, TR _10, US _21, WORLD _46, WORLD _49 | — | Observed `<option>` list |
| Attacks / commanders / troops / tools / buildings / resources / alliance / healing / feasts / quests / gifts / events / scheduling / anti-ban / notifications / logs | — | **Not visible.** Every bot feature sits behind linking a real GGE castle | Unknown | Gated |

## Gated or unreachable areas
- **All bot configuration** is gated. The account page offers only "Add castle" and "Change password". Plugins, attack settings and dashboards presumably appear per castle after linking, which needs real GGE credentials. Per the rules, I stopped there.
- **`/admin.html`** returns HTTP 200 on panel.empirebot.win. This is the operator's admin area, so I did not open it. Further guessing of page URLs was blocked by the permission classifier, and I stopped probing.
- **Pricing and paid tiers** are not published. You get them by contacting the operator, and no contact channel is listed.

## Notable for a competitor
- It is a minimal hosted product: Italian-only UI with no marketing, docs or community links. The trust signal is very weak, because users must hand over their GGE password with nothing to go on.
- The trial clock starts on the first castle link, not at sign-up. That is a sensible way to avoid burning trial days before setup.
- The server list maps zone codes to `EmpireEx_N` instance names, including newer ones (`EmpireEx_43`, `_46`, `_49`, `HANT _37`, `ES _38`). It is a useful cross-check for our own server list.
- Email verification is required before linking a castle, and the panel shows clear inline banners for it ("Email confermata!", resend link).
- Billing is manual ("contact us to extend") and has no self-serve payment.
