# Site and server monitors

Monitors (Computer section, feature `monitors`, off until switched on) checks the person's
websites, servers and ports on a schedule, from this computer, and says when one goes down,
comes back, or its certificate is about to expire. (Not to be confused with the system monitor in
Health, docs/MONITOR.md.)

## What it checks

| Kind | How | Up when |
|---|---|---|
| **Website** | `GET` the address with `User-Agent: Keeper/<version> (site check; https://keeper.ashforde.org)`, following up to 5 redirects | the answer is in the expected range (`200-399` by default, e.g. `200,204`), and (optionally) a word is on the page, or is not ("Down when the word is there") |
| **Certificate** | read from the TLS connection of the address asked for | not expired; a warning a week, two weeks (default) or a month before it expires, once a day |
| **Port** | a TCP connection | it connects |
| **Ping** | the system's `ping` (one packet; `/sbin/ping` on macOS, `ping -n 1` on Windows) | a reply; where the system has no ping program the monitor pauses itself with that reason (not an outage) |
| **DNS name** | the system's DNS servers, for an A, AAAA, CNAME, MX or TXT record | there is an answer and (optionally) it includes the expected value |

Each monitor has its own interval (30 seconds, 1, 5 (default), 15 minutes or an hour) and a time
limit (10 seconds by default). Network errors are put in plain words ("The name could not be
found", "Nothing answers on that port", "The certificate is for another name").

## Down and up again

One failed check is a blip; **two in a row** make a monitor down (`DOWN_AFTER`). The first good
check after that makes it up again. Each change is said once:

- in the Island (or as a system notification when the Island is off),
- through Phone Alerts (`phoneAlert('monitors', …)`, high priority for down, docs/PHONE-ALERTS.md),

unless the monitor's *Tell me when it goes down or comes back* is off.

## Uptime and response times

`core/site-monitor.ts` keeps every check of the last 24 hours and folds older ones into hourly
summaries for 30 days (`record`). The panel shows uptime for today, 7 and 30 days, the typical
(median) response time, the certificate's days left, the response-time chart and an up/down strip
for the last 24 hours in half-hour steps, and the last 20 checks (closed by default).

## Light when idle

- Off, or on with no monitor switched on: no timer, nothing read or written.
- On: one regular check through the governor (`monitors.check`), sleeping until the next monitor
  is due (at least 15 seconds), at most four checks at a time. It keeps running while the screen is
  locked (that is when a server going down matters), and slows down on battery or in Save battery
  like every other regular check.
- Stored in `<userData>/monitors.json`, written at most every 1.5 seconds. Up to 200 monitors.
- Keeper's firewall rules apply: a blocked host is reported as such and not contacted.

## Import and export

*Import* takes a plain list, one per line, the same form *Copy my list* gives back:

```text
https://example.com
Shop, https://shop.example.com/health
tcp mail.example.com:993
port db.local 5432
ping 192.168.1.1
dns example.com MX
nas.local:5000
blog.example.net
```

A bare domain is a website, a bare IPv4 address is ping, `host:port` is a port, `#` starts a
comment, and anything not understood is listed back. Monitors already there are skipped.

## Platforms

Website, port and DNS checks use Node's own networking and work the same on macOS, Windows and
Linux. Ping uses the system's program (its output is read in English, German or French). Checks
come from this computer, so they say whether a site answers *from here*.

## Code

`core/site-monitor.ts` (tests: `test/site-monitor.test.ts`), `core/api-monitors.ts`,
`electron/services/site-monitor.ts`, `electron/ipc/site-monitor.ts`, `src/screens/Monitors.tsx`,
`src/styles/monitors.css`; end to end: `test/e2e/monitors.cjs`.
