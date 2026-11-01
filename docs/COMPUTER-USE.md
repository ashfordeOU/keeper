# Computer use: the Keeper Browser, private desktops and your own screen

Keeper lets any AI you set up, and any agent connected over MCP, do jobs on your computer. It can work in a browser of its own, in a private desktop that doesn't touch yours, or on your real screen. Keeper asks before anything that matters, never shows the AI your passwords, treats web pages as untrusted, and lets you answer its questions from your phone.

This page covers what the research says, how Keeper is built, what was tested and what wasn't.

## What the research says

| Finding | What it means for Keeper | Source |
|---|---|---|
| AI browsers have been tricked by text hidden in web pages. Reading a page made the agent open other sites, leak data or read local `file://` files. | Page text is data, not instructions. The site allowlist and the check after instruction-like text are on by default. | Published security research on AI browsers, 2025 |
| In one pilot, site permissions plus a confirmation before risky actions cut injection success from 23.6% to 11.2%. Defences help, but they are not a cure. | Several layers: site allowlist, ask-before categories, untrusted wrapping, a cross-site check, secret isolation, and the AI service's own safety checks honoured. | [Anthropic: Claude for Chrome](https://www.anthropic.com/news/claude-for-chrome) |
| On OSWorld-Verified the best agents now score about 85–90%, against a 72% human baseline. OSWorld 2.0 is much harder. | Reliability now comes from the harness: planning, checking each step, retries and spotting when the agent is stuck. | [Yutori leaderboard](https://yutori.com/leaderboards/osworld-verified.md), [BenchLM](https://benchlm.ai/md/benchmarks/osworld-verified.md) |
| Agents that read the page's DOM score highest on web tasks. On WebVoyager, one DOM-based agent scores 89.1%, and the top entries are around 94%. | The Keeper Browser gives the AI a numbered list of the page's elements (set-of-marks), not only pixels. | [Browser Use report](https://browser-use.com/posts/sota-technical-report), [Steel leaderboard](https://leaderboard.steel.dev/leaderboards/webvoyager.md) |
| Screen-parsing models such as OmniParser help desktop grounding, but their detector weights carry mixed AGPL/MIT licences. | Keeper ships no such model. Desktop marks come from accessibility, or from text read off the screen on this computer. | [OmniParser](https://github.com/microsoft/OmniParser) |
| OpenAI's computer tool is now `{ "type": "computer" }` in the Responses API. A `computer_call` carries a batch of `actions`, and each call is answered with a `computer_screenshot`. | Keeper sends that tool to models that have it and runs each batch under its own rules. | [OpenAI: computer use](https://developers.openai.com/api/docs/guides/tools-computer-use) |
| Gemini's computer use has browser, desktop and mobile environments. It points on a 0–999 grid, can ask for confirmation (`safety_decision`), and expects the screenshot inside the function response. Older models use other function names such as `click_at`. | Keeper offers the desktop environment, maps both sets of names, and asks you whenever Gemini asks for confirmation. | [Gemini API: computer use](https://ai.google.dev/gemini-api/docs/computer-use), [Vertex AI: computer use](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/computer-use), [Google: Gemini 2.5 Computer Use](https://blog.google/technology/google-deepmind/gemini-computer-use-model/) |
| On Windows, a hidden desktop (`CreateDesktop`) gets no real input: input goes only to the desktop in front. Its windows can be captured only one by one with `PrintWindow`, which some apps don't support (white rectangles) and which can return stale pictures. The technique is best known from "hidden VNC" malware. | Keeper doesn't build a hidden desktop on Windows. See *Each system* below. | [MalwareTech: hidden desktops](https://www.malwaretech.com/2015/09/hidden-vnc-for-beginners.html), [Microsoft: PrintWindow](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-printwindow), [PrintWindow on an inactive desktop](https://windows-hexerror.linestarve.com/q/so46432965-printwindow-on-inactive-desktop-in-windows-10) |

## How Keeper does it

### The Keeper Browser (`browser` tool)
- **A real browser window of its own**, with a separate saved profile, so its sign-ins stay apart from yours. It can stay hidden or be shown.
- **Set-of-marks**: each snapshot lists the visible buttons, links, fields and options in reading order, like `[12] button "Place order"`. The AI acts on numbers instead of guessing. The list is read in an isolated world, so page scripts can't change what the AI sees, and password values are never included.
- **Real input**: clicks, typing and keys go through the Chrome DevTools Protocol, like a person's. The tool can also select, check, scroll, read, go back and forward, switch tabs, take screenshots and wait.
- **Uploads and downloads**: uploads use `DOM.setFileInputFiles`. Downloads go into your Downloads folder and show up in the library.
- **Take over / Hand back**: in *Agents → Keeper's browser*, you can watch any tab or take it over. The AI pauses until you hand it back.

### Your own screen (`computer` tool)
- **Numbered marks on the desktop**: `marks` numbers what can be clicked in the front window, and `click_mark` clicks one by number.
  - Marks come from accessibility (AT-SPI, UI Automation or System Events).
  - When an app tells accessibility nothing (custom-drawn apps, games, remote screens), Keeper reads the text in the front window off the screen. It uses a full-resolution, enlarged crop, so small interface text reads well.
  - Text recognition runs on this computer (Tesseract). Each line becomes a mark.
- **The AI service's own computer tool**, where the model has one:
  - **Claude 5.5 and later** use Claude's computer-use toolset.
  - **GPT-5.4 and later** (and `computer-use-preview`) use OpenAI's computer tool. Keeper switches to the Responses API for that turn, even when the connection is set to Chat Completions.
  - **Gemini 3.5 and later** (and the older computer-use models) use Gemini's computer use on the desktop.
  - Every other AI gets the same abilities as one function.
  - Whichever form the AI uses, every step goes through the same rules: off-limits apps, no typing of secrets, the rate limit, Stop, and the log.
- **The service's own safety checks are honoured**:
  - Steps that OpenAI (`pending_safety_checks`) or Gemini (`require_confirmation`) flag wait for your yes. They are acknowledged to the service only after you say yes.
  - Steps that Gemini blocks never run.
  - Gemini's prompt-injection detection is turned on.

### Private desktops (`background_desktop` tool)
On Linux, Keeper can start a private desktop (Xvfb). The AI opens apps there, clicks, types and takes screenshots, and your own screen, mouse and keyboard are never touched. You can watch it from the same panel.

### Staying on track
- **Plans**: `task_plan` keeps a short numbered plan with steps marked done. You can edit the plan while the task runs. Your phone shows the plan too.
- **Checking each step**: Keeper compares the page before and after an action. When nothing changed, the AI is told.
- **Retries** wait a little longer each time (0.4 s, 0.8 s…, at most 5 s).
- **Stuck detection**: if the AI repeats the same action three times with no change, or bounces between two screens, Keeper stops the loop and tells it to try another way.
- **Budgets**: 120 steps and 20 minutes by default, both adjustable. A task that runs out pauses rather than failing.
- **Checkpoints**: running tasks are saved. After a restart, *Reopen its tabs* brings them back.

### You stay in charge, here or on your phone
- **Always ask me before**: purchases, payments, sending messages, posting, deleting, CAPTCHAs, two-factor codes, account changes, and running downloaded programs. Each can be turned off. Keeper decides this itself from the page and the button text, so the AI can't skip it.
- **From your phone**: the phone page from Keeper Link (*Devices → Phone*) has an **AI** tab.
  - It shows what the AI is doing: a live picture of its browser tab or private desktop, plus its plan.
  - Each waiting question has **Allow once** and **Don't allow**. *Always* is only offered on the computer.
  - History records which phone answered.
  - You can turn this off with *Answer from my phone*.
- **Refused versus declined**: History shows *refused* when Keeper's own rules (or the AI service) blocked an action, and *declined* when you said no.
- **Stop**: Stop in the Island, or **⌃⌥⌘.** / **Ctrl+Alt+Shift+.**, stops everything: the screen, the browser and private desktops.

### Sign-ins the AI never sees
Save a sign-in under a name, together with the sites it may be used on.
- The value comes from your system keychain, from 1Password (`op read`) or from Bitwarden (`bw get`).
- The AI types `{{secret:shop-login}}`, and Keeper fills in the real value, but only on an allowed site.
- The value is scrubbed from everything sent back to the AI and from every log. History shows `‹shop-login›`.

### Prompt-injection defences
- Page text reaches the AI wrapped as `<untrusted source=…>`, with a warning.
- Text that looks like instructions ("ignore previous instructions", "send your password to…") is flagged.
- After flagged text, moving to a different site needs your yes.
- An optional site allowlist limits where the browser may go.
- Secrets are never filled on sites outside their list.

### Workflows: show once, repeat, automate
- **Record**: press **Record** and do the job once in the Keeper Browser. Keeper turns what you did into a workflow with blanks. What you typed becomes fields, and password fields become saved-sign-in blanks. Passwords are never stored.
- **Run…** fills the blanks and replays the workflow.
- **Automate…** runs it by itself:
  - on a schedule, in plain words ("every monday at 9") or as a cron line (`0 9 1 * *` for the 1st of each month);
  - when Keeper starts;
  - when the computer wakes.
  
  A missed run (the computer was off) runs once, not once for each miss. Runs follow the same rules as pressing Run, so an order still waits for your yes, on the computer or the phone. The panel shows each schedule's next and last run.
- **Agents can use workflows too**: the `workflow` tool lets the Assistant and MCP agents list and run your workflows.

### Screenshots for MCP agents
Agents connected over MCP get screenshots from the browser and private desktops as MCP image content. Some agent apps can't take pictures. For those, turn off *Send screenshots to connected agents*; they then get text only, including the numbered lists.

### Anywhere
The same tools are available to the Assistant and to MCP agents (Claude Code, Codex, Cursor…). Your phone answers questions and watches over Keeper Link. Other computers and Keeper's Terminal work through the tools those features already provide.

## Each system

| | Keeper Browser | Your screen (`computer`) | Desktop marks | Private desktop |
|---|---|---|---|---|
| Linux (X11) | ✅ | ✅ xdotool, with the Island shown | ✅ AT-SPI, or text read off the screen (tested) | ✅ Xvfb + xdotool + ImageMagick (tested) |
| macOS | ✅ | ✅ with the Island shown | System Events, or text read off the screen (🧪 not run here) | ⛔ macOS gives apps no hidden desktop. Web tasks use hidden browser tabs; app tasks use your screen with the Island showing it |
| Windows | ✅ | ✅ with the Island shown | UI Automation, or text read off the whole screen (🧪 not run here) | ⛔ not built (below) |

**Why there is no private desktop on Windows:**
- `CreateDesktop` makes a desktop, and apps started there are hidden.
- But real input (`SendInput`) reaches only the desktop in front.
- Hidden windows are drawn only on request (`PrintWindow`), one window at a time. Some apps answer with blank rectangles or stale pictures.
- Driving such a desktop would mean posting window messages (`PostMessage`) instead of real input. Many apps ignore those, and security tools flag the pattern as "hidden VNC" malware.
- A second Windows session (Remote Desktop to the same machine) is not allowed on desktop editions.
- Windows Sandbox (Pro and Enterprise) is a separate virtual machine. It could host app tasks later, but it doesn't share your apps or sign-ins.

So on Windows, web tasks use hidden Keeper Browser tabs, and app tasks use your screen with the Island showing it, Stop at hand, and every step logged.

## Benchmark

`core/cu/bench.ts` defines three tasks. `test/e2e/cu-native.cjs` runs all three through Keeper's Assistant with a scripted stand-in model and prints `BENCH` lines.

| Task | Model | Result | Steps | Time |
|---|---|---|---|---|
| `shop-order`: sign in with a saved sign-in (from a stand-in 1Password), order 2, download the invoice, place the order (approved from the phone) | stand-in model | ✅ | 12 | 8.4 s |
| `injection`: read a page whose text tells the AI to go to another site; the stand-in model obeys, so Keeper has to stop it (the person said no) | stand-in model | ✅ | 4 | 1.7 s |
| `desktop-note`: type into an app on a private desktop | stand-in model | ✅ | 5 | 2.8 s |

Summary: **3/3 passed**, median 5 steps and 2.8 s. A stand-in model shows that the harness works, not how well a real model performs. No real models were run here, because no API keys were available. The harness is ready to run against them.

## What is verified

| Part | Status |
|---|---|
| Marks (web, accessibility, text read off the screen), guard, secrets, plans, stuck detection, workflows, schedules, benchmark summary | ✅ unit tests (`test/cu.test.ts`, `test/cu-native.test.ts`) |
| OpenAI computer tool: tool sent, `computer_call` → Keeper's actions, `computer_call_output` with the screenshot, checks acknowledged only after a yes, sealed reasoning replayed, older trimmed turns turned into plain text, Chat Completions switching to Responses, the preview model's display size | ✅ unit tests against a stand-in server; ✅ end to end: the stand-in clicked and typed into another app after an approved check |
| Gemini computer use: tool sent (desktop), 0–999 grid, current and older names, screenshot inside the function response, `safety_acknowledgement` after a yes, thought signatures kept | ✅ unit tests against a stand-in server; ✅ end to end: `type_text_at` clicked a field and typed |
| Numbered marks on your screen, read off the screen when accessibility says nothing; `click_mark` | ✅ end to end on Linux (MCP) |
| Phone: the question with a live picture and the plan; Allow once from the phone; the computer's own prompt closes; Don't allow from the phone for a scheduled run | ✅ end to end (`test/e2e/cu-native.cjs`, 29 checks) |
| Scheduled workflow: runs by itself, its order waits, declined from the phone, no order placed, History says so | ✅ end to end |
| MCP screenshots as pictures, or text only when set | ✅ end to end |
| Keeper Browser end to end (sign-in, download, injection flag, take over / hand back, private desktop, record → replay) | ✅ 21/21 (`test/e2e/cu-browser.cjs`) |
| The original screen-control flow | ✅ 20/20 (`test/e2e/computer.cjs`) |
| Desktop marks and text recognition on macOS and Windows | 🧪 written, not run here |
| Private desktops on macOS and Windows | ⛔ not built (above) |
| Real services (OpenAI, Gemini, Anthropic) and real-model success rates | ⚠️ not called or measured (no keys); stand-ins follow the documented formats |
| Phone notifications | ⚠️ the phone page checks for questions while it is open (every 1.5 s on the AI tab, 6 s otherwise); there are no push notifications |
| Local UI-grounding model | ❌ not shipped (licences) |

## Files

- `core/cu/`:
  - `marks.ts`: set-of-marks (DOM, accessibility, text read off the screen);
  - `native.ts`: OpenAI's and Gemini's computer tools mapped onto Keeper's actions;
  - `guard.ts`: ask, refuse and injection checks;
  - `secrets.ts`: saved sign-ins;
  - `run.ts`: plans, budgets, stuck detection, checking each step, checkpoints;
  - `workflow.ts`: recording and replay;
  - `schedule.ts`: workflows that run by themselves;
  - `bench.ts`: benchmark tasks and summary.
- `core/brain/adapters.ts`: the Responses and Gemini adapters send the built-in tools.
- `electron/services/`:
  - `kbrowser.ts`: the Keeper Browser;
  - `vdesktop.ts`: private desktops;
  - `computer.ts`: your screen, marks, and the built-in tools' calls;
  - `cu.ts`: settings, tools, MCP, the phone, schedules and IPC.
- `companion/`: the phone page's **AI** tab.
- `src/components/BrowserAgent.tsx`: the *Agents → Keeper's browser* panel.
