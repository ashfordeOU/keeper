# Terminals for people and for agents — research and Keeper's design

This note looks at what a modern editor-integrated terminal does, how AI coding
agents use terminals today and where that breaks, and how Keeper's Terminal is
designed to do better at both. It was written while building Keeper's agent
terminals and agent hub (October 2026). Sources are listed at the end.

## 1. The editor-integrated terminal (VS Code as the reference)

**Shell integration** is the foundation. Scripts injected into bash, zsh, fish
and PowerShell print escape sequences around each prompt and command:
`OSC 633;A/B/C/D` (prompt start, prompt end, command start, command finished
with exit code), `633;E` (the exact command line, with a nonce) and `633;P`
(properties such as the working directory). The older FinalTerm `OSC 133`,
iTerm2's `OSC 1337` and `OSC 7` are also understood. Quality is graded None /
Basic / Rich. [1]

On top of that the terminal offers:

- **Command decorations**: a coloured mark per command (success or failure),
  also in the scroll bar; a menu to copy its output or re-run it. [1]
- **Command navigation**: jump between commands with Ctrl/Cmd+Up/Down. [1]
- **Command guide** and **sticky scroll**: the command whose output you are
  reading stays pinned at the top. [1]
- **Run recent command** (Ctrl+Alt+R): history from this session, earlier
  sessions and the shell's history file, with contiguous or fuzzy search. [1]
- **Go to recent directory** (Ctrl/Cmd+G). [1]
- **IntelliSense in the terminal**: files, folders, commands, arguments and
  options, triggered with Ctrl+Space or automatically. [1]
- **Quick fixes**: a port in use (kill and re-run), `git push` without an
  upstream, a mistyped git subcommand, a pull-request link, PowerShell
  "command not found" feedback. [1]
- **Persistent sessions**: *reconnection* after a window reload and *revive*
  (scrollback restored, process relaunched) after a restart. [2]
- **Environment variable collections** contributed by extensions. [2]
- **Images** through Sixel and the iTerm inline-image protocol, Unicode 11
  widths, custom key sequences, accessibility (an accessible buffer, audio cues
  on failure). [1][2]

Other leading terminals and multiplexers add **blocks** (each command and its
output as one unit you can copy, search and share), **AI command search** and an
**agent mode** for natural-language tasks, **workflows** (saved, parameterised
command sequences) [3]; and multiplexers add **detach/attach**, session restore
and scripting (`send-keys`, `capture-pane`) [5].

## 2. How coding agents use terminals today

- **VS Code agent mode**: `run_in_terminal`, `get_terminal_output` for
  background terminals; recently `send_to_terminal` to keep interacting with a
  background terminal, and notifications when a background command finishes or
  needs input (`chat.tools.terminal.backgroundNotifications`). Before that, an
  agent had to poll and could not tell when a command needed input. [4]
- **Claude Code**: a Bash tool with background commands (output to a file the
  model reads) and background sub-agents that surface permission prompts in the
  main session. [6]
- **Codex CLI**: commands run in a sandbox (`read-only`, `workspace-write`,
  `danger-full-access`) under an approval policy (`untrusted`, `on-request`,
  `never`); the default is `workspace-write` + `on-request`, with network off by
  default. [7]
- **Multi-agent setups in tmux**: one pane per agent, `send-keys` to type
  (text and Enter sent separately, because fast text+Enter can be taken as a
  paste and not submitted), `capture-pane` and prompt-glyph polling to see when
  an agent is done, one git worktree per agent. Fragile: it depends on the
  exact prompt glyph. [5]
- **MCP terminal servers**: process tools such as `start_process`,
  `read_process_output`, `interact_with_process`, `force_terminate`,
  `list_sessions`, returning cleaned output with a waiting / finished / timeout
  status; or tools that type into and read an existing terminal app. [8]
- **Agent Client Protocol (ACP)**: the editor runs commands for the agent:
  `terminal/create` (returns at once), `terminal/output` (output so far,
  `truncated`, `exitStatus`), `terminal/wait_for_exit`, `terminal/kill`,
  `terminal/release`; output beyond `outputByteLimit` drops the oldest part;
  terminals can be embedded in tool calls; the client must check `cwd` and
  apply its own permission policy and neutralise control sequences. [9]

### Where it goes wrong

| Failure | What happens |
| --- | --- |
| Interactive prompts | A command asks "Continue? [y/N]" or for a password; the agent waits until a timeout, or answers blindly. |
| Pagers | `git log`, `man`, `psql` open a pager and never return. |
| ANSI noise | Colours, cursor moves and progress bars (`\r`) bloat output and confuse models. |
| Long-running servers | `npm run dev` never ends; agents need to start it, read the address, and keep it running in the background. |
| Output size | Huge logs blow the context; cutting from the start loses the error at the end. |
| Hung or orphaned processes | Sub-processes outlive the agent that started them. |
| Secrets | Tokens and passwords printed by programs go straight to a cloud model. |
| Runaway agents | Too many terminals, destructive commands, nothing that stops them at once. |
| No collaboration | Agents of different kinds (and different accounts) cannot see or talk to each other except through ad-hoc files or tmux scraping. |

## 3. Keeper's design, and where it goes further

**One terminal engine for people and agents.** Every terminal runs in Keeper's
session host (a separate process), so terminals survive the window closing and,
when an agent asks, Keeper quitting. People see agent terminals as tabs with a
🤖 badge; agents can open headless ones.

**Agent terminal API** (`core/terminal/agent/manager.ts`), exposed identically
as MCP tools, through the agent-to-agent layer, as `keeper term …` and in
Keeper's windows:

- `term_create` with **parent** (sub-workers), **group**, **time limit**,
  headless; `term_run` with `wait` = exit / regex / none, `stdin`, timeout and
  interrupt; `term_read` (cursor based), `term_write`, `term_keys` (`C-c`,
  `Enter`, `Up`…), `term_wait` (regex / quiet / input), `term_list` (tree),
  `term_snapshot`, `term_resize`, `term_close` (cascading), `term_show`
  (optionally handing the terminal to the person).
- **Exact command boundaries in any shell**: each command is wrapped with two
  invisible marks carrying a random value (a private OSC code; plain marker
  lines for cmd.exe), so the start, the end and the exit code are known even
  without shell integration, and the echoed command line can never be mistaken
  for the end. This is stronger than polling for a prompt glyph.
- **No hangs**: pagers are switched off (`PAGER=cat`, `GIT_PAGER=cat`,
  `GIT_TERMINAL_PROMPT=0`, …); a program that asks a question is reported as
  `waiting-for-input` with the question, instead of timing out; a command that
  outlives its call is still noticed when it finishes.
- **Clean, bounded output**: escape codes removed, `\r` progress collapsed,
  output kept as head + tail (errors are usually at the end) with the full text
  saved to a file; **secrets blanked** (keys, tokens, passwords, card numbers).
- **Lifecycle and quotas**: sub-workers end with their parent; time limits;
  a cap on terminals per agent; sub-workers run at lower priority; an orphan
  reaper; terminals of agents re-adopted after Keeper restarts; one timer for
  the next deadline instead of polling.

**Safety, under the person's control**: agents need the person's permission to
use terminals at all (ask once per agent, or always); commands that delete,
force-push, run as administrator, pipe the internet into a shell, publish, or
change live systems wait for an explicit yes; allow and deny lists; folders
agents must stay in; a full transcript per terminal for 14 days; a pane badge
and an Island alert; **Stop all agent terminals** at once; the person can take
any terminal over (the agent's typing is refused) and hand it back.

**The agent hub — agents of every kind working together**
(`core/terminal/agent/hub.ts`, `bus.ts`, `bridge.ts`, `recipes.ts`):

- **Identity**: agents Keeper starts (Claude Code, Codex, Gemini, Grok,
  Cursor, OpenClaw, Hermes, aider, opencode, …) get a token in their
  environment; `keeper mcp`, which the agent runs as its MCP server, presents
  it, so Keeper knows which agent (harness, model, account/profile, terminal)
  is calling. Apps that connect on their own are asked about once.
- **Directory, messages, rooms and threads**, `@mentions`, broadcasts, and
  questions that wait for an answer (`hub_ask`).
- **Shared task board** across harnesses and accounts: post, claim (one wins),
  complete, fail, and **handoff** with a context bundle (summary, files, notes,
  shared-note keys, a terminal's last output).
- **Locks** with leases (released when the holder's terminal ends) and a
  versioned **scratch board** per group.
- **Events** any agent can wait on: a message or mention, a command finishing,
  a terminal ending or asking for input, a lock freeing.
- **The bridge** for agents without MCP (or busy ones): Keeper types the message
  in at the agent's prompt when it is idle (text, a pause, then Enter, as the
  tmux experience recommends), waits for it to finish, and passes its answer
  back as a reply. MCP-capable agents just get a one-line nudge. Messages queue;
  Keeper never interrupts an agent mid-work.
- **Accounts stay apart**: only what agents write to each other crosses over;
  sign-ins and config folders never do; per-agent permissions (send, receive,
  tasks, handoff, terminals, receive from the same account only); pause.
- **Teams (recipes)**: plan-build-review, fan-out/gather, compare answers,
  consensus — each role filled with an installed agent that suits it.

**Editor-class help for people**: decorations, prompt jumps and command
duration (already there); quick fixes (install a missing command, free a port,
pull before push, git typos, missing Python/Node modules, permissions); sticky
scroll; **Run recent command** (Ctrl+Alt+R, contiguous or fuzzy); suggestions
(Ctrl+Space: history, common tools' subcommands, git branches); `file:line:col`
links from compilers, linters and tests open in your editor; git commit ids
become `git show`; `.env` loading per profile; screen-reader mode; images
(Sixel/inline); session revive.

### What is verified

- 24 automated tests (`test/agent-terminal.test.ts`) with a real session host
  and real bash shells: exit codes, clean output, long output cut and saved,
  secrets blanked, a question reported and answered, timeouts with interrupt,
  stdin, sub-workers in parallel, cascading close, time limits, quotas,
  approvals, take-over, tools, an MCP round trip, and the bridge.
- An end-to-end run of the real app (`test/e2e/agentterm.cjs`, 24 checks):
  three stand-in agents of different kinds (two over MCP with different
  accounts, one prompt-only through the bridge) open a parent terminal and two
  sub-workers that run in parallel, a lock prevents a clash, they talk in a
  room, a task goes post → claim → handoff → answer, `rm -rf` waits for the
  person (who declines), the person takes a terminal over from the Agents view,
  closing the parent ends the sub-workers, and `keeper hub agents` works.

### Not verified

- Real Claude Code, Codex, Gemini, Grok or other agent CLIs talking through the
  hub (Claude Code is installed in the build container but needs a signed-in
  account; no account was used). The per-program idle-prompt patterns used by
  the bridge are best guesses.
- Windows (PowerShell / cmd.exe marks) and macOS shells; only Linux bash ran.
- Recipes launching real agents.

## Sources

1. VS Code, *Terminal Shell Integration* — https://code.visualstudio.com/docs/terminal/shell-integration
2. VS Code, *Terminal Advanced* — https://code.visualstudio.com/docs/terminal/advanced
3. Warp documentation (blocks, agent mode, workflows) — https://docs.warp.dev/agents/warp-ai/agent-mode, https://docs.warp.dev/quickstart/
4. VS Code 1.115 agent terminal tools — https://www.infoworld.com/article/4156038/visual-studio-code-1-115-introduces-vs-code-agents-app.html, https://agentpatterns.ai/tool-engineering/send-to-terminal-background-interaction/
5. tmux agent orchestration skills (community) — https://playbooks.com/skills/openclaw/skills/tmux
6. Claude Code tools reference — https://code.claude.com/docs/en/tools-reference
7. Codex sandboxing and approvals — https://developers.openai.com/codex/concepts/sandboxing
8. Desktop Commander MCP terminal handlers; iTerm MCP — https://glama.ai/mcp/servers/@wonderwhy-er/DesktopCommanderMCP, https://docsearch.algolia.com/mcp/docs/repo/ferrislucas/iterm-mcp
9. Agent Client Protocol, Terminals — https://agentclientprotocol.com/protocol/terminals
