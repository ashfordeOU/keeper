<!-- SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0 -->
# AI usage and subscription tracker

Keeper tracks what is left of each of your AI accounts: the coding tools' 5-hour and weekly limits, credits, balances and monthly budgets. It also tracks the subscriptions you pay for. It warns you before something runs out and tells you when it comes back.

You can keep as many accounts per service as you like. Each account has its own name, colour and badge. You can reorder accounts, pause them, leave them out of the menu-bar label and choose which of their limits to show. Keys are kept in the system keychain through Keeper's secret store. On a system with no keychain, Keeper keeps keys only until it quits, and the Accounts tab says so.

| Surface | What it does |
|---|---|
| **Menu bar / tray** | A ring showing the share left of the most urgent limit (amber when low, red when used up), with a label beside it. The label can be one of four things, chosen in Settings → Menu Bar: **Icon only**; **Most urgent**, the 1–3 limits closest to running out (`CC 25%  CX 0% · 22h 10m`); **Reset countdowns** (`CX Reset 22h 10m`); or **Busy day**, which always shows the lowest limits. A `+N` shows how many more need attention. You can also hide the item completely while nothing is running out. On macOS the label is text beside the ring. Windows and Linux show only pictures, so the number is drawn inside the ring and the full label goes in the tooltip. Right-click opens Refresh now, Usage page, Menu Bar Settings and Pause tracking. |
| **Pop-over** | Click the item to open it. It follows Keeper's theme, light or dark, and is translucent on macOS. **Priority** lists *Running Out* rows, each with a ring and service badge, the limit, the account name, "N% left" and the reset countdown. Below that are greyed *Used Up* rows with "resets in …", then *Use It Before It Resets*. When nothing needs attention it shows **All Clear** ("Nothing is running out."). **All Metrics** lists every account and limit, grouped by service, with bars, amounts (tokens, requests, $ spent against the budget) and a sparkline of the last week. The footer shows "Next update in 2m" and a ••• menu: Refresh now, Open Usage page, Settings…, Pause tracking. |
| **Usage page** (sidebar → More → Usage) | **Overview** (priority list and a card per account); **Accounts** (add, edit, reorder, remove, plus coding tools' folders found on this computer); **Subscriptions** (monthly total per currency, renewals, trials, allowances, *Look for receipts in Mail*); **Costs** (per month, chart and table); **History** (7, 30 or 90 days per limit); **Settings**. Export CSV writes the history and the monthly costs. |
| **Island** | While a limit is running out or used up, an activity with a ring of the share left. It opens to Details (the pop-over) and the Usage page, and can be turned off like any other activity kind. |
| **Notifications** | A limit runs low or is used up ("Codex Plus Weekly: 3% left"), which also raises an Island alert. A limit resets ("Codex Team 5-hour reset: 95% available"). Unused allowance is about to reset (off by default). A subscription renews or a trial ends, a set number of days before. Each warning is sent once per window. |
| **Command palette** | *Usage: Show AI Usage*, *Open the Menu-bar Pop-over*, *Refresh Now*, *Add an Account…*, *Subscriptions*, *Costs per Month*, *Export CSV…*, *Pause or Resume Tracking*, *Menu Bar Settings…* |
| **CLI** | `keeper usage [--json] [--refresh]`. When the app is closed, it shows the last saved numbers and says they are old. |
| **AI ability / MCP** | `usage_status` is read-only and allowed by default. It returns the text summary and JSON (running out, used up, expiring, every limit with its reset), so agents can check their own limits before a big job. |
| **Features** | `usageTracker` is on by default and costs nothing until an account is added. `usageMenuBar` (on by default) needs `usageTracker`. |

## What counts as urgent

The logic is in `core/usage-tracker/priority.ts`, which is pure and unit-tested. You can change the thresholds in Settings → Menu Bar or Usage → Settings.

- **Running out**: at or below *Running out at* (default 30% left). It also counts as running out when *Also when the pace says so* is on and the pace says the limit runs out before its reset. Keeper measures the pace from the last two hours of history in this window when there is enough of it. Otherwise it uses the average since the window began, but only after 15% of the window has passed.
- **Used up**: at least 99.5% used. These rows are greyed, with "resets in …".
- **Use it before it resets**: at least *N*% unused (default 40%) and resets within *H* hours (default 24), on windows of two days or longer, such as weekly and monthly. The 5-hour and daily windows reset too often to be worth a warning.
- Sort order: running out (least left first), then used up (soonest reset first), then expiring.
- When a window's reset time has passed, it counts as full again until the next look, so a stale "used up" never lingers.

## Sources

**Official** sources use documented files, formats or endpoints. **Unofficial (opt-in)** sources use undocumented endpoints with a tool's own saved sign-in. Each one is a per-account switch that is off by default and labelled *Unofficial; may break*, with a one-line explanation in the account editor. Until the switch is on, Keeper sends nothing to that endpoint (the e2e test checks this). No source reads browser cookies.

| Source | Official / Unofficial (opt-in) | Accuracy | Where the numbers come from | Verified |
|---|---|---|---|---|
| **Claude Code**: session files (one account per config folder; `CLAUDE_CONFIG_DIR`) | Official (local files) | estimated | Token counts from `<folder>/projects/**/*.jsonl` (assistant turns' `message.usage`, with streamed duplicates removed). The 5-hour block starts at the hour of the first message after the previous block ended. The week is the last 7 days, or follows a weekly reset time learned from an exact reading. Shares are worked out against plan limits you enter; Anthropic does not publish token numbers for plans. | Fixtures and e2e |
| **Claude Code**: *Read the limits from its status line* switch | Official (documented status-line JSON), opt-in | exact | The status-line JSON carries `rate_limits.five_hour` / `seven_day` (`used_percentage`, `resets_at`) and `spend_limit`. The switch is off by default. It **edits that account's `settings.json`** so its `statusLine` runs a small script first, which saves the JSON to `<folder>/keeper-status.json` and then runs your own status line. Turning it off **restores the file** as it was. Keeper watches that one file. | The script runs end to end in e2e. The live fields need a Pro/Max account: **not verified live** |
| **Claude Code**: *Ask Anthropic with its own sign-in* switch | **Unofficial (opt-in)** | exact | The tool's saved sign-in (`.credentials.json`, or the macOS keychain for the default folder) sent to Anthropic's **undocumented** `api/oauth/usage` endpoint, which may stop working at any time. Off by default. | Parser tested. **Not verified live** |
| **Codex** (one account per `CODEX_HOME`) | Official (its own logs) | exact | The newest `token_count` events in `<home>/sessions/YYYY/MM/DD/rollout-*.jsonl`. `rate_limits.primary` / `secondary` give `used_percent`, `window_minutes` and `resets_at`. Older logs used `resets_in_seconds`, which still works. Keeper also reads `credits`, `individual_limit` and `plan_type`, keeping the newest snapshot per `limit_id`. Format checked against `codex-rs/protocol/src/protocol.rs`. | Fixtures and e2e. **Not verified** with live logs |
| **GitHub Copilot** | **Unofficial (opt-in)** | exact | Copilot's saved token (`~/.config/github-copilot/{apps,hosts}.json`) sent to GitHub's undocumented `api.github.com/copilot_internal/user`. Shows premium requests, chat and completions left this month (unlimited ones are skipped). Uses the same reader as the Island's usage tool. | Fixture and e2e stub. **Not verified live** |
| **Cursor** | **Unofficial (opt-in)** | exact | The Cursor *app's* saved sign-in (`cursorAuth/accessToken` in its `state.vscdb`, read with the `sqlite3` command, not from a browser) sent to cursor.com's undocumented `api/usage` endpoint. Shows requests used this month against the allowance. Uses the same reader as the Island's usage tool. | Fixture and e2e stub (with a stand-in `sqlite3`). **Not verified live** |
| **Gemini CLI**: session files | Official (local files) | estimated | Requests and tokens from `<folder>/tmp/*/chats/session-*.json`, against the daily allowance you enter (about 1,000 a day by default). | Parser tests |
| **Gemini CLI**: *Ask Google for the quota left* switch | **Unofficial (opt-in)** | exact | Gemini CLI's saved Google sign-in (`oauth_creds.json`; Keeper never refreshes it) sent to the Code Assist endpoints the CLI itself uses (`v1internal:loadCodeAssist`, then `v1internal:retrieveUserQuota`). Returns `remainingFraction` and `resetTime` per model. Format checked against gemini-cli's `code_assist/types.ts`. | Fixture and e2e stub. **Not verified live** |
| **Qwen Code** | Official (local files) | estimated | The same session-file count as Gemini CLI (about 2,000 requests a day by default). | Parser tests |
| **OpenCode** | Official (local files) | exact (its own costs) | `<folder>/storage/message/**.json`: tokens and the cost recorded for each reply, this month, against a budget. | Parser tests |
| **Anthropic API** | Official | exact | Admin key: `GET /v1/organizations/usage_report/messages` and `/v1/organizations/cost_report` (cents), month to date, with paging, against your budget. | Mapped from the API reference examples. **Not verified live** |
| **OpenAI API** | Official | exact | Admin key: `GET /v1/organization/usage/completions` and `/v1/organization/costs`. | Mapped from the cookbook examples. **Not verified live** |
| **OpenRouter** | Official | exact | `GET /api/v1/key`: `limit`, `limit_remaining`, `limit_reset`, daily and monthly usage, free-model requests. | Docs and e2e stub |
| **DeepSeek** | Official | exact (balance) | `GET /user/balance` → `balance_infos[].total_balance`. With the amount you topped up, it becomes a share. | Docs and e2e stub |
| **xAI** | Official | exact (balance) | Management key and team id: `GET /v1/billing/teams/{team}/prepaid/balance` → `total.val` (USD cents; credit counts negative). | The sign convention is **not verified** |
| **Mistral**, **Groq**, **Gemini API** | Official (Keeper's own calls) | estimated | None of these has a key-based usage endpoint. Keeper counts its own calls this month and reads the rate-limit headers on them (`x-ratelimit-*`) for requests and tokens left this minute. | Unit tests |
| **Keeper's own AI calls** | Official (Keeper's log) | exact | Calls, tokens and cost from Keeper's AI connections this month, against a budget. Rate-limit headers from its calls (`anthropic-ratelimit-*`, `x-ratelimit-*`) are kept in memory. | Unit tests |
| **Subscriptions** | Manual | manual | Price, cycle, renewal date, trial end and an allowance with its reset. *Look for receipts in Mail* reads only the sender, subject and preview of "receipt"/"invoice" messages from known AI services, keeps nothing and marks nothing read. | Unit tests; the Mail search is **not verified** end to end |
| **Custom source** | whatever the endpoint is | exact | Any JSON endpoint plus JSONPath fields for used, limit and reset, with an optional bearer token. | Unit tests |

**Sources considered and left out:**
- **Web dashboards that need browser cookies**, such as the Claude.ai or ChatGPT usage pages. They are left out because they would need the browser's cookies.
- **Antigravity, Kiro, Amp, Windsurf.** No local record or stable endpoint was found.
- **Gemini API quota.** It lives only in Cloud Monitoring, which needs OAuth or a service account.

## Settings (all in Settings → Menu Bar and Usage → Settings)

| Group | Option | Default |
|---|---|---|
| Menu bar | *AI usage in the menu bar* (the `usageMenuBar` feature) | on (shown once an account exists) |
| | *The label shows*: Icon only, Most urgent, Reset countdowns, Busy day | Most urgent |
| | *How many*: 1–3 | 1 |
| | *Show “+N” for the rest* | on |
| | *Service letters before each number* | on |
| | *Nothing in the menu bar when all is clear* | off |
| | *Show in the menu bar* (per account) | on |
| Running out | *Running out at* N% left | 30% |
| | *Used up at* N% used | 99.5% |
| | *Also when the pace says so* (forecast) | on |
| | *Use it before it resets*: N% unused within H hours | 40%, 24 h |
| | *Only for windows of at least* H hours | 48 h |
| Notifications | *When a limit runs low or is used up* (also an Island alert) | on |
| | *When a limit resets* | on |
| | *Unused allowance about to reset* (opt-in; the pop-over always shows these) | **off** |
| | *Subscriptions renewing and trials ending* (days before, per subscription) | on, 3 days |
| How often | Files on this computer / Services | 2 min / 10 min |
| | *Pause tracking* (also in the ••• and tray menus) | off |
| Per account | the unofficial switches above, *Limits to show*, *Paused* | off / all / off |

## Cost and privacy

- **Nothing runs with no accounts.** There are no polls, no watcher and no menu-bar item. The e2e test checks this before the first account is added and after the last one is removed.
- Every look goes through the governor: `poll('aiUsage.local')` runs every 2 minutes by default, `poll('aiUsage.api')` every 10 (5–120 allowed). Both slow down while you are away and stop while the screen is locked. A failing account backs off (2×, 4×, … up to an hour).
- Parsed files are cached by size and modification time, so a look re-reads only files that changed. Folders untouched since the window began are skipped.
- The status-line file is watched (one folder, not recursive) instead of polled.
- Only the services' own endpoints are called, with your keys. Tests point them at a local stub through `KEEPER_USAGE_STUB`, which official builds ignore.
- History keeps 10-minute points for a week, then hourly highs, for 90 days, in `usage-tracker.json` in Keeper's data folder (mode 600).

## Files

- `core/usage-tracker/model.ts`: types, the list of sources, settings, formatting
- `core/usage-tracker/sources.ts`: every parser and response mapping
- `core/usage-tracker/priority.ts`: running out, used up, expiring, the pace forecast, transitions
- `core/usage-tracker/label.ts`: the menu-bar label and the tray ring picture
- `core/usage-tracker/subscriptions.ts`: renewals, reminders, totals, receipts, history, CSV
- `core/usage-tracker/rate-store.ts`: rate-limit headers from Keeper's own calls
- `electron/services/usage-tracker.ts` and `electron/ipc/usage-tracker.ts`: the main process, IPC, `keeper/usage` and `usage_status`
- `src/screens/usage/`: the pop-over, the page, the settings and the palette commands
- `cli/usage.ts`
- Tests: `test/usage-tracker.test.ts`, `test/usage-tracker-sources.test.ts` (fixtures in `test/fixtures/usage-tracker/`) and `test/e2e/usage-tracker.cjs`
