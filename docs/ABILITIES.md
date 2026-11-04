# Abilities for every AI

Keeper gives whichever AI you use the abilities of a full assistant: web search with sources, research reports, public posts, pictures, looking at pictures, running code, memory, schedules, personas, projects, voice and teams of AIs. They are the same everywhere an AI meets Keeper:

| Where | How it gets the abilities |
| --- | --- |
| Keeper's Assistant (any AI you connect) | offered next to the file tools |
| MCP clients — Claude Code, Codex, Cursor, VS Code, … | as MCP tools from `keeper mcp` / the MCP endpoint |
| Plain chat apps through Keeper's gateway | ask for `<model>+abilities`, or turn on *Give every gateway model Keeper's abilities*; Keeper runs the abilities the AI calls and passes the app's own tool calls back |
| Other agents (A2A, ACP), voice assistants, scheduled requests | through Keeper's assistant, which has them |

Each ability is **Off**, **Ask** (Keeper shows *Allow once / Always allow / Don't allow*) or **Allow** under Agents → Automation → Skills (the built-in skills, under your own). *Stay on this computer* turns off everything that reaches the internet.

## The abilities

| Ability | Default | Needs |
| --- | --- | --- |
| `web_search` | Allow | a search service: SearXNG (your own), Brave, Tavily, Exa, Kagi, Google Programmable Search or xAI. Without one, the built-in search answers from Wikipedia and DuckDuckGo's Instant Answer API only. Bing's API was retired by Microsoft in August 2025. |
| `fetch_page` | Allow | nothing. Only public `http(s)` addresses; this computer, the home network and redirects into either are refused. 3 MB, 20 s. |
| `deep_research` | Ask | a search service and an AI. Plans 3–5 searches, reads up to 8 pages (quick 4, thorough 16) within 5 minutes, notes each, looks for gaps, writes a report with numbered sources; saved in *Documents/Keeper Research*. |
| `social_search` | Allow | Hacker News, Mastodon hashtags: nothing. X: an xAI key (xAI's `x_search` tool; the older live-search parameter now returns 410). Bluesky: your handle and an app password (post search needs a session). Reddit: your own Reddit app id (installed-client grant). |
| `image_generate`, `image_edit` | Ask | OpenAI, Gemini, xAI or Stability AI key, or a Stable Diffusion web UI / ComfyUI on this computer. Edits: OpenAI, Gemini, Stable Diffusion web UI. Saved in *Pictures/Keeper AI*. |
| `look_at_image` | Allow | an AI that takes images (the picture is passed to it); text in it is also read on this computer. |
| `ask_document` | Allow | nothing; uses Keeper's brain. |
| `run_code` | Ask | nothing for JavaScript; Python 3 for Python. |
| `remember`, `recall`, `forget` | Allow / Allow / Ask | nothing. |
| `schedule_task` | Ask | nothing. |
| `speak` | Allow | nothing (this computer's voices). |

## Sealed code

Every run gets a fresh temporary folder and a time limit; output is capped at 64 KB.

- **Linux**: `unshare` gives a new user, mount and network namespace — no network, and `/home`, `/root`, `/media`, `/mnt`, `/run/user` covered by empty folders.
- **macOS**: `sandbox-exec` with no network, no reading of `/Users` or `/Volumes`, writing only in the workspace. *Written and unit-tested; not run on a Mac.*
- **Windows**: there is no system sandbox Keeper can use without administrator rights, so Python is off, and JavaScript runs in Node's permission model (files only in the workspace, no programs) inside a bare `vm` context without network objects. A determined escape from `vm` could still reach the network on Windows.
- JavaScript everywhere also runs with Node's permission model.

## Memory

Memories are kept in Keeper's data folder (`abilities/memories.json`, readable only by you). Each is shared, or belongs to one persona or project. They go to an AI on the internet only if *Memories may go to AIs on the internet* is on **and** the memory is marked *cloud*. Agents → Memory lists them all; edit, pin, delete, or forget everything.

## Teams

| Strategy | What happens |
| --- | --- |
| Side by side | everyone answers; answers shown next to each other |
| Writer and reviewer | first member answers, second reviews, first revises (until “LGTM” or the rounds run out) |
| Panel with a chair | everyone answers; the first member merges them |
| Planner and workers | the first member splits the job into parts, the others do them in parallel, the first assembles |
| Best for the job | each request goes to the member whose strengths match; anything that looks private goes to a member on this computer |

Members are your AI connections and — when the agent hub is running — agent sessions in Keeper's Terminal. Every team has a call limit.

## Safety

- Web pages, search results and posts reach the AI inside `<untrusted_web_content>` with a note that it is data, not instructions; look-alike wrapper and role tags inside the text are removed.
- Abilities that spend money or run code ask by default. Asking uses the same prompt as agent actions; *Always allow* is remembered per ability.
- Keys are kept in the system keychain. Costs (calls and units per service and ability) are recorded on this computer; enter prices to see amounts.

## What was tested

- Unit tests (`test/abilities.test.ts`, 34 tests): every search provider's request and parsing against a fake internet; page extraction; address checks; redirects into a private network refused; social sources; image providers and the ComfyUI graph; deep research with a scripted AI (including untrusted wrapping and the page limit); the sandbox for real (JavaScript has no `require`, `process` or `fetch`; cannot read outside the workspace; Python on Linux has no network and sees no home folders; endless loops stopped); memory scopes and cloud rules; schedules in plain words and cron; personas; all five team strategies, call limits and cloning; the dispatcher's permissions and local-only mode; MCP exposure; gateway injection.
- Real app on Linux (`test/e2e/abilities.cjs`, 12 checks) with a stand-in OpenAI-compatible AI, SearXNG and Stable Diffusion web UI on this computer: the Assistant searches the web and cites; results reach the AI wrapped; making a picture asks first and the picture is saved; a memory is kept; a one-off scheduled request fires into the Island and switches itself off; two AIs answer side by side; no page errors.

**Not tested with real accounts**: Brave, Tavily, Exa, Kagi, Google, xAI (search, X and images), OpenAI/Gemini/Stability images, Bluesky, Reddit, Mastodon's live servers, and speech-to-text services. Request formats follow each service's documentation as of October 2026. The macOS sandbox profile and Windows speech were not run.
