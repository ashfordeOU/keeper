<!-- SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0 -->
# AI usage and subscription tracker

Keeper tracks what is left of each of your AI accounts: the coding tools' 5-hour and weekly limits, credits, balances and monthly budgets. It also tracks the subscriptions you pay for. It warns you before something runs out and tells you when it comes back.

You can keep as many accounts per service as you like, including several Claude or ChatGPT subscriptions signed in inside Keeper (see [Web sign-ins](#web-sign-ins-claudeai-and-chatgptcom)). Each account has its own name, colour and badge. You can reorder accounts, pause them, leave them out of the glance card and choose which of their limits to show. Keys are kept in the system keychain through Keeper's secret store. On a system with no keychain, Keeper keeps keys only until it quits, and the Accounts tab says so.

| Surface | What it does |
|---|---|
| **The owl's glance** | Keeper has one icon in the menu bar or tray, the owl. The tracker has no item of its own: an **AI usage** card in the owl's glance shows the most urgent limits, with a bar for the share used (amber when low, red when used up), and opens the Usage page. What the card says is chosen in Settings → Menu bar: **Most urgent**, the 1–3 limits closest to running out (`CC 25%  CX 0% · 22h 10m`); **Reset countdowns** (`CX Reset 22h 10m`); **Busy day**, which always shows the lowest limits; or **Just how it stands** (All clear, Running low, Used up). A `+N` shows how many more need attention. The card can show only while something runs low, and can be switched off like any glance card. On Windows and Linux the owl's tooltip includes it. |
| **Usage page, Overview** | **Priority** lists *Running out* rows, each with a ring and service badge, the limit, the account name, "N% left" and the reset countdown. Below that are greyed *Used up* rows with "resets in …", then *Use it before it resets*. When nothing needs attention it shows **All clear**. Each account's card shows its limits with bars, amounts (tokens, requests, $ spent against the budget) and a sparkline of the last week. |
| **Usage page** (sidebar → More → Usage) | **Overview** (priority list and a card per account); **Accounts** (add, edit, reorder, remove, plus coding tools' folders found on this computer); **Subscriptions** (monthly total per currency, renewals, trials, allowances, *Look for receipts in Mail*); **Costs** (per month, chart and table); **History** (7, 30 or 90 days per limit); **Settings**. Export CSV writes the history and the monthly costs. |
| **Island** | The **AI Usage** tab shows the tracker's accounts, each by its name, with its limits as bars, the share left and the reset countdown, most urgent first; accounts that need it offer *Sign in again* or the unofficial switch. *+ Add account* opens Usage → Accounts → Add; with no accounts the choices are offered in the tab. While a limit is running out or used up, an activity with a ring of the share left. It opens to Details (the owl's glance) and the Usage page, and can be turned off like any other activity kind. The optional ring beside the pill follows the tracker too, named by account. |
| **Notifications** | A limit runs low or is used up ("Codex Plus Weekly: 3% left"), which also raises an Island alert. A limit resets ("Codex Team 5-hour reset: 95% available"). Unused allowance is about to reset (off by default). A subscription renews or a trial ends, a set number of days before. Each warning is sent once per window. |
| **Command palette** | *Usage: Show AI Usage*, *Show in the Glance*, *Refresh Now*, *Add an Account…*, *Subscriptions*, *Costs per Month*, *Export CSV…*, *Pause or Resume Tracking*, *Glance and Warning Settings…* |
| **CLI** | `keeper usage [--json] [--refresh]`. When the app is closed, it shows the last saved numbers and says they are old. |
| **AI ability / MCP** | `usage_status` is read-only and allowed by default. It returns the text summary and JSON (running out, used up, expiring, every limit with its reset), so agents can check their own limits before a big job. |
| **Features** | `usageTracker` is on by default and costs nothing until an account is added. (The old `usageMenuBar` switch is gone: someone who had switched it off has the AI usage card left out of the glance instead.) |

## What counts as urgent

The logic is in `core/usage-tracker/priority.ts`, which is pure and unit-tested. You can change the thresholds in Settings → Menu bar or Usage → Settings.

- **Running out**: at or below *Running out at* (default 30% left). It also counts as running out when *Also when the pace says so* is on and the pace says the limit runs out before its reset. Keeper measures the pace from the last two hours of history in this window when there is enough of it. Otherwise it uses the average since the window began, but only after 15% of the window has passed.
- **Used up**: at least 99.5% used. These rows are greyed, with "resets in …".
- **Use it before it resets**: at least *N*% unused (default 40%) and resets within *H* hours (default 24), on windows of two days or longer, such as weekly and monthly. The 5-hour and daily windows reset too often to be worth a warning.
- Sort order: running out (least left first), then used up (soonest reset first), then expiring.
- Several accounts of one service are told apart everywhere by their names. The letters before each number are the account's own badge when it has one, the service's letters when it is that service's only account, else the service's first letter and the first letter of what tells the name apart ("Claude — Work" → `CW`); when two services would read the same, the first two letters of that word (`Pe`, `Pl`).
- When a window's reset time has passed, it counts as full again until the next look, so a stale "used up" never lingers.

## Sources

**Official** sources use documented files, formats or endpoints. **Unofficial (opt-in)** sources use undocumented endpoints with a tool's own saved sign-in. Each one is a per-account switch that is off by default and labelled *Unofficial; may break*, with a one-line explanation in the account editor. Until the switch is on, Keeper sends nothing to that endpoint (the e2e test checks this). No source reads your browser's cookies; the claude.ai and chatgpt.com accounts sign in inside Keeper, each in a partition of its own.

| Source | Official / Unofficial (opt-in) | Accuracy | Where the numbers come from | Verified |
|---|---|---|---|---|
| **Claude (claude.ai)**: web sign-in, *Read usage from claude.ai* switch | **Unofficial (opt-in)** | exact | See [Web sign-ins](#web-sign-ins-claudeai-and-chatgptcom). `GET /api/organizations`, then `GET /api/organizations/{org}/usage`: `five_hour`, `seven_day`, `seven_day_opus`, `seven_day_sonnet` (`utilization` in %, `resets_at`), any other `seven_day_*`, a newer `limits[]` list, and `extra_usage` (cents). The plan comes from the organization's `rate_limit_tier` and `capabilities`. | Fixtures and an e2e stub. **Not verified live** |
| **ChatGPT (chatgpt.com)**: web sign-in, *Read usage from chatgpt.com* switch | **Unofficial (opt-in)** | exact | See [Web sign-ins](#web-sign-ins-claudeai-and-chatgptcom). `GET /api/auth/session` gives a short-lived token (kept in memory for that one request), then `GET /backend-api/wham/usage`, the endpoint Codex itself asks: `plan_type`, `rate_limit.primary_window` / `secondary_window` (`used_percent`, `limit_window_seconds`, `reset_at`, `reset_after_seconds`), `code_review_rate_limit`, `additional_rate_limits[]`, `credits`. Field names from codex-rs. When it answers nothing, the plan shows with "add its Codex folder for exact numbers". | Fixtures and an e2e stub. **Not verified live** |
| **Claude Code**: session files (one account per config folder; `CLAUDE_CONFIG_DIR`, which may list several separated by commas) | Official (local files) | estimated | Token counts from `<folder>/projects/**/*.jsonl` (assistant turns' `message.usage` or a top-level `usage`: input, output and both cache kinds, the nested `cache_creation` when the total is missing). A reply written once per content block counts once, with its largest reading; the tool's own zero-token notices (such as a limit message) are skipped. The account with no folder set reads both `~/.config/claude` (newer versions) and `~/.claude`. The source line says what was read ("Counted 120 replies from 4 session files in ~/.claude", "Read 1 session file in ~/.claude; no replies in the last 7 days"). Claude Code on the web and claude.ai leave nothing on this computer: add a Claude (claude.ai) account for those. The 5-hour block starts at the hour of the first message after the previous block ended. The week is the last 7 days, or follows a weekly reset time learned from an exact reading. Shares are worked out against plan limits you enter; Anthropic does not publish token numbers for plans. | Fixtures and e2e |
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
- **Your browser's cookies.** No source reads them. The claude.ai and chatgpt.com accounts are signed in inside Keeper instead, each in its own partition.
- **Antigravity, Kiro, Amp, Windsurf.** No local record or stable endpoint was found.
- **Gemini API quota.** It lives only in Cloud Monitoring, which needs OAuth or a service account.

## Web sign-ins (claude.ai and chatgpt.com)

Much of the work on a Claude or ChatGPT subscription happens on the web (claude.ai, Claude Code on the web, Codex in the cloud), which leaves nothing on this computer. These accounts are signed in inside Keeper.

- **Adding one.** Usage → Accounts → *Add account* → *Claude (claude.ai)* or *ChatGPT (chatgpt.com)* (also *+ Add account* in the Island). Give it a name ("Claude — Work") or leave it empty to use the email you sign in with. *Sign in to claude.ai…* opens the provider's own login page (`claude.ai/login`, `chatgpt.com/auth/login`) in a window of its own. Sign in with a password, a code or Google/Apple as usual; the window closes itself once the site has set its session cookie and confirmed who is signed in (`/api/account`; `/api/auth/session`). Closing the window first drops the new account.
- **One partition per account.** Each account's window and requests use the Electron session partition `persist:usage-<accountId>`, so two Claude accounts never share cookies. Keeper never sees or stores the password; the provider's cookies live only in that partition. The window has no preload and runs sandboxed; pop-ups (Google, Apple) stay in the same partition; the partition refuses camera, microphone, location and notifications; its user agent is Chromium's without the Electron and app tokens, since some sign-in pages refuse those.
- **Removing one** clears the partition's storage, cookies, cache and HTTP auth, and deletes its folder under `Partitions/`. Partitions left by a removal cut short are wiped at the next start.
- **Reading usage is unofficial and opt-in.** Until *Read usage from claude.ai* (or *chatgpt.com*) is on for that account, Keeper sends nothing for its usage (the e2e test checks this); the only request before that is the "who is signed in" one right after signing in. The switch says: *Unofficial: uses claude.ai's own pages; may stop working.* Requests go only to the provider's own origin, with that account's partition (`session.fromPartition(…).fetch`), at the service interval (10 minutes by default) and never more often: a *Refresh* within the interval shows the last reading. Signing in again, turning the switch on or choosing another organization reads once straight away.
- **Signed out.** A 401 (or a 403 that is the site's own JSON, or a redirect to its login page) marks the account signed out: it shows *Sign in again* on the Usage page and in the Island, and nothing more is sent until then. A browser check (Cloudflare's challenge page) says so and asks for *Sign in again* once to pass it. A 429 waits for the next look; other failures back off as usual.
- **Organizations.** A claude.ai sign-in with several organizations (a Team and a personal one) reads the paid one that can chat; the editor lists the others to choose from.
- **ChatGPT.** The Codex 5-hour and weekly limits come from the same endpoint Codex asks; they cover Codex in the cloud as well as the CLI. When chatgpt.com gives none, the account shows its plan and suggests adding the Codex folder.
- **Not verified live.** The endpoints are undocumented; the shapes were taken from public sources (the open-source CodexBar's claude.ai notes, codex-rs's `RateLimitStatusPayload`) and the parsers in `core/usage-tracker/web.ts` skip anything they do not recognise. Tested with fixtures and a local stand-in for both sites (`test/e2e/usage-web.cjs`, through `KEEPER_USAGE_STUB`, which official builds ignore; `KEEPER_USAGE_SIGNIN_HIDDEN` keeps the window hidden in tests only).

## Settings (all in Settings → Menu bar and Usage → Settings)

| Group | Option | Default |
|---|---|---|
| Glance | *AI usage in the glance* (the glance's AI usage card) | on (shown once an account exists) |
| | *The card shows*: Most urgent, Reset countdowns, Busy day, Just how it stands | Most urgent |
| | *How many*: 1–3 | 1 |
| | *Show “+N” for the rest* | on |
| | *Service letters before each number* | on |
| | *Only when something runs low* | off |
| | *Show in the glance* (per account) | on |
| Running out | *Running out at* N% left | 30% |
| | *Used up at* N% used | 99.5% |
| | *Also when the pace says so* (forecast) | on |
| | *Use it before it resets*: N% unused within H hours | 40%, 24 h |
| | *Only for windows of at least* H hours | 48 h |
| Notifications | *When a limit runs low or is used up* (also an Island alert) | on |
| | *When a limit resets* | on |
| | *Unused allowance about to reset* (opt-in; the Usage page always shows these) | **off** |
| | *Subscriptions renewing and trials ending* (days before, per subscription) | on, 3 days |
| How often | Files on this computer / Services | 2 min / 10 min |
| | *Pause tracking* (also on the Usage page and in the command palette) | off |
| Per account | the unofficial switches above, *Limits to show*, *Paused*; web accounts: *Sign in again*, *Organization* | off / all / off |

## Cost and privacy

- **Nothing runs with no accounts.** There are no polls, no watcher and no glance card. The e2e test checks this before the first account is added and after the last one is removed.
- Every look goes through the governor: `poll('aiUsage.local')` runs every 2 minutes by default, `poll('aiUsage.api')` every 10 (5–120 allowed). Both slow down while you are away and stop while the screen is locked. A failing account backs off (2×, 4×, … up to an hour).
- Parsed files are cached by size and modification time, so a look re-reads only files that changed. Folders untouched since the window began are skipped.
- The status-line file is watched (one folder, not recursive) instead of polled.
- Only the services' own endpoints are called, with your keys. Tests point them at a local stub through `KEEPER_USAGE_STUB`, which official builds ignore.
- History keeps 10-minute points for a week, then hourly highs, for 90 days, in `usage-tracker.json` in Keeper's data folder (mode 600).

## Files

- `core/usage-tracker/model.ts`: types, the list of sources, settings, formatting
- `core/usage-tracker/sources.ts`: every parser and response mapping
- `core/usage-tracker/web.ts`: web sign-ins: partition names and cleanup, what an answer means, the claude.ai and chatgpt.com parsers
- `electron/services/usage-web.ts`: the sign-in window, requests with an account's partition, wiping a partition
- `core/usage-tracker/priority.ts`: running out, used up, expiring, the pace forecast, transitions
- `core/usage-tracker/label.ts`: the short label and the glance card (`glanceUsage`)
- `core/usage-tracker/subscriptions.ts`: renewals, reminders, totals, receipts, history, CSV
- `core/usage-tracker/rate-store.ts`: rate-limit headers from Keeper's own calls
- `electron/services/usage-tracker.ts` and `electron/ipc/usage-tracker.ts`: the main process, IPC, `keeper/usage` and `usage_status`
- `src/screens/usage/`: the page, the settings and the palette commands; the card itself is drawn by the glance (`src/glance/`)
- `src/island/tools/UsageTool.tsx`: the Island's AI Usage tab
- `cli/usage.ts`
- Tests: `test/usage-tracker.test.ts`, `test/usage-tracker-sources.test.ts`, `test/usage-tracker-web.test.ts` (fixtures in `test/fixtures/usage-tracker/`), `test/e2e/usage-tracker.cjs` and `test/e2e/usage-web.cjs`
