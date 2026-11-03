# Keeper usage stats server

A small Cloudflare Worker with a D1 database that receives Keeper's anonymous
usage stats and shows totals on a dashboard. What the app sends, and why, is in
[docs/PRIVACY-USAGE-STATS.md](../../docs/PRIVACY-USAGE-STATS.md).

| | |
| --- | --- |
| `POST /v1/ping` | One install's report (and up to six earlier days it could not send). Checked strictly against the app's own schema in `core/telemetry.ts`: anything else, a body over 32 KB, or a day outside the last week is refused. At most 6 requests per install ID per hour. One row per install per day. |
| `POST /v1/crash` | Anonymous crash and error reports, sent only by people who switched them on (Settings → Privacy). Checked strictly against `core/crash-report.ts`: an error's name, the process, the version and system, and stack frames reduced to function, file name and line; no message, no paths, no install ID. At most 20 reports and 24 KB per request; 600 requests a minute for the whole service. Kept 90 days. |
| `GET /v1/stats` | Totals and percentages only, for the dashboard. Needs `Authorization: Bearer <STATS_TOKEN>`. |
| `/` | The dashboard (`dashboard/index.html`): paste the token, press Load. |
| Daily job (03:17 UTC) | Keeps a summary of yesterday (counts only, no install IDs) for good, deletes raw rows older than 13 months, crash reports older than 90 days and old rate-limit windows. |

**The client's internet address is never stored.** The code never reads
`CF-Connecting-IP`, `X-Forwarded-For` or `request.cf`, never logs, and the
tables have no column for it (a test checks this). Cloudflare's own request
logging is switched off in `wrangler.toml` (`[observability] enabled = false`,
`logpush = false`); step 7 below turns off the rest in the Cloudflare dashboard.

## Deploy (step by step)

You need a Cloudflare account (the free plan is enough) and Node.js 22.

1. **Sign in.** In this folder:

   ```bash
   cd server/telemetry
   npm install
   npx wrangler login
   ```

2. **Create the database.**

   ```bash
   npx wrangler d1 create keeper-telemetry
   ```

   Copy the `database_id` it prints into `wrangler.toml` (replace the zeros).

3. **Create the tables.**

   ```bash
   npm run db:init
   ```

4. **Set the stats token** (a long random secret; keep it in your password manager):

   ```bash
   openssl rand -hex 32            # copy the output
   npx wrangler secret put STATS_TOKEN
   ```

5. **Deploy.**

   ```bash
   npm run deploy
   ```

   Wrangler prints an address like `https://keeper-telemetry.<you>.workers.dev`.
   Check it: `curl -s -X POST -H 'content-type: application/json' -d '{}' <address>/v1/ping`
   should answer `{"error":"only \"pings\" is allowed"}`.

6. **Use your own domain.** The app sends to `https://telemetry.ashforde.org/v1/ping`
   (`TELEMETRY_ENDPOINT` in `core/telemetry.ts`). With `ashforde.org` on Cloudflare:
   uncomment the `routes = [...]` line at the end of `wrangler.toml` and run
   `npm run deploy` again, or in the dashboard open *Workers & Pages → keeper-telemetry →
   Settings → Domains & Routes → Add → Custom domain* and enter `telemetry.ashforde.org`.
   To use another domain, change `TELEMETRY_ENDPOINT` and `TELEMETRY_HOST` in
   `core/telemetry.ts` and the privacy page, then release Keeper.

7. **Make sure nothing logs addresses.** In the Cloudflare dashboard:
   - *Workers & Pages → keeper-telemetry → Settings → Observability*: Workers Logs **off**,
     Logpush **off**, no Tail Workers.
   - *Analytics & Logs → Logpush* for the zone: no job that includes this hostname.
   - Leave *Security → WAF* rate-limiting rules by address off for this hostname unless
     you are under attack (they process addresses, though they do not store them for us).

8. **Open the dashboard** at your domain (`https://telemetry.ashforde.org/`), paste the
   token and press **Load**. **Sample data** shows the page with made-up numbers.
   The page also works opened straight from disk (`dashboard/index.html`); type the
   server address in the first box.

Until the server is deployed, Keeper's sends fail quietly and each copy keeps at
most a week of unsent days.

## Develop

```bash
npm run db:init:local
npx wrangler dev                 # http://localhost:8787
```

Point a development build of Keeper at it with
`KEEPER_TELEMETRY_URL=http://localhost:8787/v1/ping KEEPER_TELEMETRY_INTERVAL_MS=5000 npm run dev`
(both are ignored by official builds).

The checks and the totals are plain functions in `src/logic.ts`, tested with the
app's tests (`npx vitest run test/telemetry-server.test.ts` from the repository root).
The breakdowns read the last 30 days of rows in one query, which is fine to tens of
thousands of active installs; beyond that, move them into SQL `GROUP BY` queries.

## Retention

| What | Kept |
| --- | --- |
| Raw rows (one per install per day) | 13 months, then deleted by the daily job |
| Rate-limit windows (install ID, time, count) | 2 days |
| Daily summaries (counts and percentages, no install IDs) | For good |
| Crash reports (`crashes`, no install ID) | 90 days, then deleted by the daily job |

To delete one install's rows on request (the person reads their ID in Settings → Privacy):

```bash
npx wrangler d1 execute keeper-telemetry --remote --command "DELETE FROM pings WHERE install_id = '<id>'"
```
