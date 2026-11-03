# Keeper license server

A small Cloudflare Worker with a KV namespace that makes **Keeper Pro** licenses. It is
written and tested (`test/license-server.test.ts`) but **not deployed**: Keeper Pro is
switched off ([docs/PRO.md](../../docs/PRO.md)).

| | |
| --- | --- |
| `POST /v1/webhook/lemonsqueezy`, `/v1/webhook/paddle` | The provider's signed webhook. A new purchase becomes a signed license, e-mailed to the buyer; a renewal updates it; a cancellation runs to the end of the period; a refund revokes it. |
| `POST /v1/refresh` `{ token }` | The newest license for this one (the app asks a week before a subscription's end), or `{ revoked: true }`. |
| `POST /v1/activate` `{ token, seat }` | Counts a computer (its random Pro reference) against the seats. |
| `POST /v1/deactivate` `{ token, seat }` | Frees it, to move the license. |
| `POST /v1/restore` `{ email }` | E-mails that address its licenses again (at most every 10 minutes); the answer never says whether there were any. |

**Nothing personal is kept.** The buyer's address is used to send the e-mail and stored only
as the same SHA-256 hash the license carries. The code never reads or logs the client's
internet address; Cloudflare's request logs are off in `wrangler.toml`.

## Deploy (when Pro is switched on)

You need a Cloudflare account, Node.js 22, the signing keys (`node scripts/pro.mjs keys`), a
store at Lemon Squeezy or Paddle, and an e-mail service that takes
`POST { from, to, subject, text }` with a bearer key (the default `EMAIL_API_URL` is Resend's).

```bash
cd server/license
npm install
npx wrangler login
npx wrangler kv namespace create LICENSES        # copy the id into wrangler.toml
npx wrangler secret put LICENSE_PRIVATE_KEY      # the private key from scripts/pro.mjs keys
npx wrangler secret put LEMONSQUEEZY_WEBHOOK_SECRET   # or PADDLE_WEBHOOK_SECRET and PADDLE_API_KEY
npx wrangler secret put EMAIL_API_KEY
```

In `wrangler.toml` set `LICENSE_PUBLIC_KEY` (the public key, as in `core/pro/keys.ts`) and
`PLANS` (the provider's variant or price ids → `"pro"` or `"team"`). Then
`npx wrangler deploy`, attach `license.ashforde.org` (the `routes` line), and point the
provider's webhook at `https://license.ashforde.org/v1/webhook/<provider>`.

When a license is refunded, add its id to `revoked` in `pro.json` and sign it again
(docs/PRO.md): apps that are offline when they would ask `/v1/refresh` learn it from there.
