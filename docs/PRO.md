# Keeper Pro

Keeper Pro is built into Keeper and **switched off**. In 1.0.0 nothing about it exists for
anyone: no page, no row, no badge, no "upgrade", no network request and no timer. This page
is for the owner: what is there, how to switch it on when Keeper has enough people, how to
make the keys and how to connect the payment provider.

## The promise: free stays free

Keeper is free to use, at home and at work (README, LICENSE.md). Pro never changes that:

- **Every feature that exists in Keeper up to the version in which payments are switched on
  stays free for everyone, old and new users alike, forever.** That version is recorded once
  as `"freeThrough"` in `.github/release.json` and never changes after.
- Only features **added after** that version can be Pro or Team, and only ones that **cost
  Ashforde money to run** (servers, storage, hosted AI) or that are **for teams and
  businesses**.
- It is decided **by feature, not by install date**: a person who installs Keeper years later
  gets every feature up to `freeThrough` free, exactly like someone who installed 1.0.0.

How the code holds to it:

- `core/entitlements.ts` is the one place that answers "may this person use that?"
  (`entitlements(…).has('pro.cloudSync')`). Every part in `core/features.ts` is free.
  A paid feature carries `introducedIn`; when `introducedIn <= freeThrough` it is free
  whatever the plan.
- `test/fixtures/free-forever-features.json` lists every part Keeper had in 1.0.0.
  `test/entitlements.test.ts` fails if any of them is ever marked paid, and fails when a
  new part is added to `core/features.ts` without being added to that list (which only
  grows).
- Because `freeThrough` is the switch-on version itself, a feature that ships *in* that
  version is free too: the first paid features ship in a later version.

## What is built

| Piece | Where | What it does |
| --- | --- | --- |
| The switch | `core/pro-switch.ts`, `scripts/pro-flags.mjs`, `.github/release.json` | `proEnabled` and `freeThrough`, read by the app, the interface and the `keeper` command alike at build time |
| Entitlements | `core/entitlements.ts` | Plans (`free`, `pro`, `team`; Team includes Pro), the paid-feature registry, where a plan comes from (a license, or an App Store purchase) |
| Licenses | `core/pro/license.ts` | Signed tokens checked on the computer, offline; 30 days of grace past a subscription's end |
| Remote switch | `core/pro/config.ts` | The signed `pro.json`: stop offering Pro (kill switch), offer it to a share of installs (rollout), checkout links, refunded licenses |
| Payments | `core/pro/payments.ts` | One interface; Lemon Squeezy and Paddle (direct download), a StoreKit stand-in (Mac App Store) |
| On the computer | `core/pro/client.ts`, `electron/services/pro.ts`, `electron/ipc/pro.ts` | The license in the keychain, the daily read of `pro.json`, renewing, seats, checkout in the browser, `keeper://license?token=…` |
| Interface | `src/components/ProAccount.tsx` | Settings → Account & Pro, the Pro pill, the upgrade sheet |
| Command line | `cli/license.ts` | `keeper license [status|verify <license>|activate <license>|deactivate]` |
| License server | `server/license/` | A Cloudflare Worker that turns the provider's webhook into a license and e-mails it (written and tested, **not deployed**) |
| Usage stats | `core/telemetry.ts` (`PRO_USAGE_SCHEMA`) | The plan (`free`, `pro` or `team`), sent only by versions with Pro on |

With Pro off, `proAccount` (its part in `core/features.ts`, marked `pro: true`) is left out
everywhere a part for another system is: Settings → Features, setup, search, Quick Search and
the Settings section. The service never starts: no file, no keychain read, no timer, no
request. `test/pro-off.test.ts` and `test/e2e/pro.cjs` check this.

## Switching it on

1. **Make the keys** (once, on your own computer):

   ```bash
   node scripts/pro.mjs keys
   ```

   It prints a public key and a private key and saves neither.
   - Put the **public** key in `core/pro/keys.ts` (`PRO_PUBLIC_KEYS`) and in
     `server/license/wrangler.toml` (`LICENSE_PUBLIC_KEY`).
   - Store the **private** key as the license server's secret
     (`npx wrangler secret put LICENSE_PRIVATE_KEY`) and as the repository secret
     `KEEPER_PRO_PRIVATE_KEY` (for signing `pro.json`), and in your password manager.
     It never goes in the repository.
   - Moving to a new key later: list both public keys (newest first) for a few releases.

2. **Set up the payment provider** (below) and **deploy the license server**
   (`server/license/README.md`).

3. **Publish `pro.json`** at `https://keeper.ashforde.org/pro.json`:

   ```bash
   cat > /tmp/pro-config.json <<'JSON'
   { "enabled": true, "rollout": 10,
     "checkout": { "provider": "lemonsqueezy",
       "pro": { "month": "https://ashforde.lemonsqueezy.com/buy/…", "year": "https://ashforde.lemonsqueezy.com/buy/…" },
       "team": { "year": "https://ashforde.lemonsqueezy.com/buy/…" },
       "manage": "https://ashforde.lemonsqueezy.com/billing" },
     "revoked": [] }
   JSON
   KEEPER_PRO_PRIVATE_KEY=… node scripts/pro.mjs sign-config /tmp/pro-config.json > site/pro.json
   ```

   `enabled: false` stops offering Pro everywhere within a day (people who bought it keep it).
   `rollout` is the share of installs (0–100) that are offered it, the same installs every day.
   `revoked` lists refunded license ids. The app reads this file at most once a day, and only
   in versions with Pro on.

4. **Switch it on for the next release:**

   ```bash
   node scripts/pro.mjs on
   ```

   It sets `"proEnabled": true` and records `"freeThrough"` (this version) the first time.
   It refuses until the public key is in `core/pro/keys.ts`. A build with `proEnabled` and no
   `freeThrough` fails. `node scripts/pro.mjs off` leaves Pro out again (`freeThrough` stays).

To try it from source without changing anything: `KEEPER_PRO=1 npm run build` (and
`KEEPER_PRO_TEST_KEY`, `KEEPER_PRO_CONFIG_URL`, `KEEPER_LICENSE_SERVER_URL` point an
unofficial build at your own test key and servers; official builds ignore them).

## Licenses

A license is `kpl1.<payload>.<signature>`: base64url JSON and an Ed25519 signature over
`keeper-license-v1\n<payload>`.

| Field | Meaning |
| --- | --- |
| `id` | The license's random id |
| `plan` | `pro` or `team` |
| `seats` | Computers (Pro) or people (Team) |
| `email` | SHA-256 of the buyer's address (lower-cased, trimmed); never the address |
| `iat` | When it was made |
| `exp` | End of the paid period, or `null` for a license that never ends |
| `via` | `lemonsqueezy`, `paddle`, `appstore` or `manual` |

- **Checked on the computer**, with no account and no server.
- **Kept in the system keychain** (`pro.license`, through the existing secrets helpers).
- **Offline grace:** a subscription keeps working for 30 days past `exp` when Keeper cannot
  reach the server to renew it. Keeper asks for the renewed license a week before `exp`.
- **Seats:** the server counts computers by each install's random Pro reference (never the
  computer's name). Offline, a license works anyway.
- **Moving it:** Settings → Account & Pro → Use on another computer (or `keeper license
  deactivate`) frees the seat; then enter it on the other computer.
- **Getting it:** the e-mail has a `keeper://license?token=…` link and the license to paste.
  Restore purchase sends it again to the address it was bought with.

The `keeper` command: `keeper license verify <license>` checks one offline; `status`,
`activate` and `deactivate` ask the running app. In versions without Pro it says so and is not
listed in the help.

## Payments

Direct downloads use a **merchant of record**, which sells to the buyer and handles EU VAT and
sales tax for Ashforde OÜ (Estonia): **Lemon Squeezy** or **Paddle**. The app only opens the
provider's hosted checkout in the browser; no card or address passes through Keeper.

- **Lemon Squeezy:** make a product with a variant per plan and period; use each variant's
  "buy" link in `pro.json`. Add a webhook to `https://license.ashforde.org/v1/webhook/lemonsqueezy`
  for `order_created`, `order_refunded`, `subscription_created`, `subscription_updated`,
  `subscription_cancelled`, `subscription_expired`, `subscription_payment_success`; put its
  signing secret in `LEMONSQUEEZY_WEBHOOK_SECRET`.
- **Paddle (Billing):** make products and prices, a hosted checkout link per price, and a
  notification destination to `…/v1/webhook/paddle` for `subscription.*` and
  `transaction.completed`; secrets `PADDLE_WEBHOOK_SECRET` and `PADDLE_API_KEY` (to look up the
  buyer's address). Check the hosted checkout's query parameters against Paddle's current
  documentation before going live.
- `PLANS` in `server/license/wrangler.toml` maps the provider's variant or price ids to `pro`
  or `team`.
- **Mac App Store edition:** Apple requires in-app purchase. `core/pro/payments.ts` has the
  `StoreKitBridge` interface and a stand-in that says purchases aren't available; the
  entitlement layer already accepts an App Store purchase as a source (`receiptSource`). The
  native side comes with the edition ([MAS-EDITION.md](MAS-EDITION.md)). The App Store edition
  never shows a web checkout or links to one.

## What people see (only with Pro on)

- **Settings → Account & Pro:** the plan (Keeper Free, Pro or Team) and one main action: See Pro
  on Free, Manage subscription with one. Enter a license, Restore purchase and Use on another
  computer are quiet links. What Pro adds lists each paid feature with its pill.
- **The Pro pill:** a small "Pro" or "Team" beside things that need that plan. Never on
  anything Keeper has today.
- **The upgrade sheet:** opens only from See Pro. It says first that everything stays free,
  lists what Pro adds, and continues in the browser. No pop-ups, nothing that interrupts work,
  no reminders.
- Team administration comes later.

## Candidate Pro features (proposal)

Registered in `PAID_FEATURES` with `introducedIn: null` (not built). None is built, and none
takes anything away from what is free.

| Id | Plan | Proposal |
| --- | --- | --- |
| `pro.cloudSync` | Pro | **Keeper Cloud sync:** settings, notes, snippets and clipboard sets between your computers and phones, encrypted end to end |
| `pro.cloudBackup` | Pro | **Keeper Cloud backup:** an encrypted copy of Keeper's own data |
| `pro.hostedLinks` | Pro | **Hosted share links:** Studio and Shelf links without storage of your own (your own storage stays free) |
| `pro.aiCredits` | Pro | **AI included:** Keeper's AI features without your own key (your own key stays free) |
| `pro.monorailBundle` | Pro | **Monorail and Keeper Pro** together |
| `team.shared` | Team | Shared vaults, snippets and connections |
| `team.admin` | Team | Admin policies for every computer in a company |
| `team.sso` | Team | Single sign-on |
| `team.support` | Team | Priority support |

## Privacy

- With Pro off: nothing.
- With Pro on: one request a day for `pro.json` (no cookies, nothing sent but the request
  itself); the license server is asked only to activate, move, renew or restore a license,
  with the license and the install's random Pro reference. Usage stats gain `plan` only
  ([PRIVACY-USAGE-STATS.md](PRIVACY-USAGE-STATS.md)), and only while usage stats are on.
