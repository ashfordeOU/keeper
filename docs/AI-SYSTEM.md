# Keeper with the system's assistants and with any AI

Keeper by Ashforde® works with the assistants built into macOS, Windows and Linux, and with whichever AI you use: Claude, OpenAI's models and Codex, Grok, Gemini, local models, and agents that speak MCP. This page says what each can do with Keeper, how it works, and how sure we are.

**Status key**
- ✅ **verified**: run end to end in the real app (Linux under Xvfb) or against real servers.
- 🧪 **built, unverified**: written and unit-tested, but not yet run on the hardware or account it needs.
- ⛔ **not possible** for a third-party app today, with the reason.

## An AI using this computer

Any AI you set up in Keeper, and any agent connected to Keeper over MCP, can use the computer the way a person does, if you allow it. It can:

- see the screen;
- move the pointer, click, drag and scroll;
- type and press keys;
- open apps, web pages and files;
- list and switch windows;
- read the controls in the front window and press one by name.

**Off by default.** Turn it on under **Agents → What agents may do → Use this computer**, with one of three settings:
- **Off**: no AI may use the computer.
- **Ask each time**: each AI asks once per session.
- **Allowed**: AIs may start without asking.

**Visible and stoppable.** While an AI works, the Island shows "<AI> is using this computer" with **Stop**. A global shortcut stops every session at once: **⌃⌥⌘.** on a Mac, **Ctrl+Alt+Shift+.** elsewhere. An AI you stopped is refused until you ask it something again.

**Off limits.** These are never looked at or touched, and you can edit both lists:
- Password managers, keychains and terminals.
- Windows whose title looks like banking or a wallet.

**Never typed.** Passwords, keys and card numbers.

**Limits.** At most 90 actions a minute. A session ends after 10 idle minutes or 60 minutes in all. All three numbers can be changed.

**Logged.** Every action goes into the agents' activity log with a small picture of what the AI saw. Pictures are kept for two weeks.

### Each kind of AI

| AI | How Keeper offers it | Status |
| --- | --- | --- |
| Claude 5.5 and later, in Keeper's Assistant | Claude's own computer-use toolset (`computer_toolset_20260801`, no beta header). Screenshots go back as images in the tool result. | 🧪 mapping unit-tested; not run against the real API here |
| Earlier Claude models, OpenAI (Chat Completions and Responses), Grok, Gemini, Mistral, DeepSeek, OpenRouter, Bedrock, local vision models (Ollama, LM Studio) | One `computer` function with an `action` field. Screenshots follow each tool result in each API's own picture format. Needs a model that can call tools and see images. | ✅ with a stand-in OpenAI-compatible AI (it clicked a button and typed into another app); 🧪 real services not called |
| OpenAI's built-in computer tool (`{ "type": "computer" }`, GPT-5.4 and later; `computer_use_preview` for the older preview model) | Sent through the Responses API, which Keeper switches to for computer turns even when the connection uses Chat Completions. Each `computer_call` batch runs through Keeper's rules and is answered with a screenshot. `pending_safety_checks` wait for the person and are acknowledged only after a yes. Sealed reasoning goes back with each turn, because nothing is stored at OpenAI (`core/cu/native.ts`, `core/brain/adapters.ts`). | ✅ with a stand-in Responses service (it clicked and typed into another app after an approved check); 🧪 real service not called |
| Gemini's computer use (`computer_use`, desktop environment; Gemini 3.5 and later, plus the older `click_at`-style names) | Its functions (0–999 grid) map to Keeper's actions. Answers go inside the function response with a screenshot. `safety_decision: require_confirmation` waits for the person, blocked steps never run, and thought signatures go back unchanged. | ✅ with a stand-in generateContent service; 🧪 real service not called |
| Claude Code, Codex CLI, Cursor, VS Code, Gemini CLI, Zed, other MCP clients | `keeper mcp` lists a `computer` tool when you allow it. Screenshots come back as MCP image content, under the same rules and prompts. | ✅ with an MCP client: screenshot, blocked terminal refused, Stop, Off hides the tool |

### Each system

| System | Pointer and keyboard | Windows and apps | Reading controls (accessibility) |
| --- | --- | --- | --- |
| Linux (X11) | xdotool | wmctrl / xdotool, `.desktop` launchers | AT-SPI through python3-gi when installed |
| Linux (Wayland) | ⛔ apps cannot inject input without the RemoteDesktop portal, which Keeper does not use yet: the screen can be seen, not controlled | — | AT-SPI |
| macOS | CGEvent through Keeper's helper (needs Accessibility) | System Events | System Events (Accessibility) |
| Windows | SendInput through a persistent PowerShell | user32 | UI Automation |

Linux X11 is ✅ verified. macOS and Windows are 🧪 not run.

## macOS: Siri, Apple Intelligence, Spotlight, Shortcuts, Writing Tools

| What | How | Status |
| --- | --- | --- |
| Siri: "Ask Keeper", "Search files with Keeper", "Open Health in Keeper", "Start focus with Keeper", "Lock my folders with Keeper" | **Keeper Intents.app**, a small helper inside Keeper.app (`native/macos/KeeperIntents`) with App Intents and an App Shortcuts provider. It answers through the `keeper` command and `keeper://` links. Keeper registers it with macOS on first start. | 🧪 written; built in CI on macOS (that step is allowed to fail until it has been proven on a Mac) |
| Shortcuts app actions | The same intents, available in Shortcuts. Ask Keeper and Search Files return text or files to the next step. Also: Run a Keeper Automation, Send to a Device, Copy Text from Screen, Keep the Mac Awake. | 🧪 |
| Spotlight | App Shortcuts appear in Spotlight. Keeper's file details go into Core Spotlight. | 🧪 |
| Apple Intelligence's on-device model as Keeper's AI | Keeper's helper (`keeper-helper`) runs Apple's Foundation Models. Choose it in Settings → AI & Brain. | 🧪 written; needs macOS 26 with Apple Intelligence on |
| Writing Tools in Keeper | macOS shows its Writing Tools in native text fields; apps built on Electron (like Keeper) do not get them. Keeper's own **Writing Help** menu, right-click in any text field, does the same jobs with your AI (including Apple's on-device model): Proofread, Rewrite, Make Friendlier, Make More Professional, Make Shorter, Summarize. | ✅ prompt and cleanup tested; 🧪 the menu itself not driven in the e2e test |
| Siri's personal context, onscreen awareness, or replacing Siri's model | ⛔ Apple does not let third-party apps provide or change these. Siri reaches Keeper only through its App Intents. | — |

## Windows: Copilot and Windows AI

| What | How | Status |
| --- | --- | --- |
| Copilot and Windows agents using Keeper | Keeper registers its MCP server with the Windows on-device agent registry (`odr.exe mcp add <manifest>`, an MCP bundle manifest version 0.3). The tools are search, read, ask and, when allowed, computer. | 🧪 needs Windows build 26220.7262 or later; preview |
| Running Keeper's server in Windows' secure agent session, and automatic registration | ⛔ for Keeper's current installer: Windows needs package identity (an MSIX package) for that. Without it the registry lists Keeper only if the person turns on *Reduce protections for agent connectors* in Settings. | — |
| App Actions on Windows, Windows AI APIs (Phi Silica) | ⛔ without package identity (MSIX). Not built. | — |
| Copilot key | Windows lets you choose which app the Copilot key opens (Settings → Personalization → Text input). | — |
| Cortana | Retired by Microsoft. | — |
| Explorer "Search with Keeper", Jump List, Windows text recognition | See [PLATFORM.md](PLATFORM.md). | 🧪 |

## Linux: desktop assistants, GNOME, KDE

| What | How | Status |
| --- | --- | --- |
| Actions on the session bus | `org.ashfordeou.Keeper.Actions` at `/org/ashfordeou/Keeper/Actions`: `ListActions`, `Run(id, params)`, `Ask(question)` (returns the answer), `Search(query, limit)` (returns paths). | ✅ against a real dbus-daemon |
| GNOME Activities search and KDE KRunner | Search providers. | ✅ |
| Launcher actions (Search, Ask Keeper, Copy Text from Screen) | In the `.desktop` file. | 🧪 |

Example:

```bash
gdbus call --session --dest org.ashfordeou.Keeper.Actions --object-path /org/ashfordeou/Keeper/Actions --method org.ashfordeou.Keeper.Actions.Ask "when does my passport expire?"
```

## Links every assistant can use

| Link | Does |
| --- | --- |
| `keeper://ask?q=…` | Asks Keeper |
| `keeper://search?q=…` | Opens a search |
| `keeper://go?page=health` | Opens a page (home, health, cleanup, agents, settings, terminal, sync, devices…) |
| `keeper://focus?minutes=25` | Starts the focus timer (`0` stops it) |
| `keeper://lock-all` | Locks every unlocked folder again |
| `keeper://automation?name=…` | Runs a saved automation |
| `keeper://capture` | Copies text from the screen |
| `keeper://awake?on=true&minutes=60` | Keeps the computer awake |

The `keeper` command gives the same from scripts:
- `keeper ask --plain "…"`
- `keeper search --brain --json …`
- `keeper link send <file> <device>`

## Other assistants

Alexa: a skill template is in `integrations/alexa` (see [AGENTS.md](AGENTS.md)).

Google Assistant: no third-party actions on desktops. Use the links, the `keeper` command or MCP from your own automations.
