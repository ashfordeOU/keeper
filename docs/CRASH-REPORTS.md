# Crash and error reports

Keeper can send Ashforde anonymous reports when something goes wrong, so it gets fixed. It is
**off by default** and stays off until the person switches it on: Settings → Privacy → *Send crash
reports* (feature `crashReports`, an own choice: presets and saved feature sets never turn it on).
While it is off nothing is collected, and switching it off deletes whatever was waiting.

Usage stats (docs/PRIVACY-USAGE-STATS.md) only count crashes; this sends what is needed to find
one, and nothing that could tell people or computers apart.

## What is sent

One request holds up to 20 reports (`core/crash-report.ts`):

```json
{
  "v": 1,
  "reports": [
    {
      "version": "1.0.0", "channel": "stable", "os": "macos", "osVersion": "15.1", "arch": "arm64",
      "process": "main", "kind": "exception", "name": "TypeError",
      "stack": ["at readPlan (main-Q1.mjs:120:7)", "at Array.forEach (<anonymous>)"],
      "count": 3, "first": "2026-11-03", "last": "2026-11-03"
    }
  ]
}
```

| Field | What it is |
|---|---|
| `version`, `channel` | Keeper's version; stable or test release |
| `os`, `osVersion`, `arch` | `macos`/`windows`/`linux`/`other`, the main version only, the processor type |
| `process` | `main`, `window`, `island`, `widgets`, `mail`, `gpu`, `utility` or `other` |
| `kind` | `exception` or `rejection` (main process), `window-error`, `window-crash`, `process-crash`, `unexpected-exit` |
| `name` | the error's class (`TypeError`) or what stopped (`WindowOutOfMemory`, `ProcessCrashed`, `UnexpectedExit`), never its message |
| `stack` | at most 12 frames, each only `at function (file.js:line:col)` |
| `count`, `first`, `last` | how often since the last send, and on which days (UTC) |

## What is never sent

- The error's **message** (it can hold names, paths or text the person typed).
- **Folders**: every frame is cut to the file's own name; web addresses to their file.
- The computer's **user name or name**: frames containing either are dropped.
- E-mail addresses, internet addresses, odd characters: frames containing them are dropped.
- An install ID, or anything else that could tell reports from one computer apart. The request
  carries no cookies or credentials.

`scrubStack` does the cleaning; `validateCrashBody` is the one check, used by the app before
sending and by the server before storing, and it refuses anything outside the table above.

## When

- Problems come from `electron/resilience.ts` (`onProblem`: the main process's uncaught errors and
  rejections, a window's uncaught errors, a window that stopped), the system's `child-process-gone`
  (the GPU or a utility process crashed), and a last run that ended without quitting.
- The same problem again only counts up (`enqueue`, by version, process, kind, name and the first
  five frames). At most 50 wait; ones older than a week are dropped.
- They go together at most every 30 minutes (one regular check through the governor, only while on),
  to `https://telemetry.ashforde.org/v1/crash`, through Keeper's firewall rules. A refused body is not
  tried again.
- `KEEPER_TELEMETRY=0`, `DO_NOT_TRACK=1` or the administrator's policy file
  (`{ "usageStats": false }`, see docs/PRIVACY-USAGE-STATS.md) switch them off too; Settings then says so.

## See what's sent

Settings → Privacy → *See what's sent* shows the reports waiting and the last ones sent, field by
field with what each means and as the exact text, the list of what is never sent, and *Delete what is
waiting*.

## The server

`POST /v1/crash` on the usage stats Worker (`server/telemetry`): checked against the same schema,
24 KB and 20 reports at most per request, 600 requests a minute for the whole service (there is no
ID to count by). Stored in the `crashes` table with no install ID or address (the Worker never reads
one); deleted after **90 days** by the daily job. Written and tested (`test/crash-report.test.ts`),
**not deployed**: apply `schema.sql` again and deploy as in `server/telemetry/README.md`.

## Code

`core/crash-report.ts`, `core/api-crash.ts`, `electron/services/crash-reports.ts`,
`electron/ipc/crash-reports.ts`, `electron/resilience.ts` (`onProblem`),
`src/components/CrashReportsPanel.tsx`, `server/telemetry/src/{logic,worker}.ts`,
`server/telemetry/schema.sql`; end to end: `test/e2e/crash-reports.cjs`.
