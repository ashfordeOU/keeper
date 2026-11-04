# Keeper's Terminal

Keeper by Ashforde® includes a terminal: tabs, split panes, every shell on the computer, SSH, and sessions that keep running when the window closes.

## Where to find it

- **Terminal** in the sidebar's **Connect** section, beside Remote Desktops, or *Terminal* in the command palette.
- Its own window: tray → *Terminal*, the palette's *New Terminal Window*, or ⌘⌥T (Ctrl+Alt+T on Windows and Linux).
- The drop-down terminal slides down from the top of the screen with Ctrl+` and tucks away when you click elsewhere.
- Right-click a folder in Browse → *Open in Terminal*, or open `keeper://terminal?cwd=/some/folder`.

Every shortcut can be changed in Terminal settings → Keyboard shortcuts.

## How it works

Terminals run inside a small **session host**, a separate background process that Keeper starts when it needs one. Because the host owns the terminals, closing a window doesn't end them. They wait under **Sessions** until you open them again or close them.

- **When Keeper's windows close** (Terminal settings → Behaviour):
  - *Keep terminals until Keeper quits* (the default)
  - *Keep terminals running even after Keeper quits*: the next time Keeper starts, they're still there.
  - *End terminals when their window closes*
- **Saved scrollback**: when the host stops, it saves each terminal's recent output, compressed, in Keeper's data folder. After a restart those terminals show as *Restored*: you can read the old output and press *Start again here* to get a new shell in the same folder.
- **Idle cost**: the host does no work at all while terminals are quiet. In testing, six idle terminals used 0.00% CPU.
- **Security**:
  - The host listens only on a private socket: a named pipe on Windows, or a socket file readable only by you elsewhere.
  - Anything that connects must present a random token from a file only your account can read, so other programs can't type into your terminals.

## Profiles

A profile decides how a terminal starts:

- **Shell and folder**: your login shell or another one, a program of your own, or an SSH host. Also the starting folder.
- **Variables**: one per line as `NAME=value`. `${PATH}` refers to the current value.
- **Start-up command**: typed in once the shell is ready.
- **Appearance**: colours (12 schemes, or *Follow Keeper's theme*), font and size, cursor, and what the bell does (flash, sound, an Island alert, or nothing).
- **Language for programs**: sets `LANG` and `LC_ALL`. Keeper's own words follow Keeper's language setting, which offers ten languages.

### Separate sign-ins per profile

Turn on **Keep this profile's sign-ins separate** and the profile gets its own folders. Command-line tools that keep their sign-in in a config folder are pointed at that profile's own folder. Two profiles can then run the same tool signed in to two different accounts, side by side in one window.

The variables Keeper sets:

- `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_STATE_HOME`, `XDG_CACHE_HOME`
- `CLAUDE_CONFIG_DIR`, for an AI assistant on the command line that reads it
- `KEEPER_PROFILE_HOME`

*Also give it its own home folder* goes further: it points `HOME` (and `USERPROFILE` on Windows) at the profile's folder. Programs then no longer see your usual dotfiles.

**Limit:** a tool that keeps its sign-in in the system keychain, rather than in files, can't be separated this way. A program can't get a second keychain.

## Working with several terminals

- **Split** right or down; the new pane is a *sister terminal*, with the same profile, folder and group.
- **Show in another pane** shows one terminal in two places. Both see the same output, and either can type.
- **Type in every pane** (⇶) sends your typing to every terminal in the tab. It asks first unless you turn the confirmation off.
- **Groups**: right-click a pane → *Group…*. Terminals in a group share:
  - the **Notes** panel;
  - a folder, `$KEEPER_SHARED_DIR`, containing `notes.md`.

  Programs in those terminals (for example several AI assistants working on one task) can read and write the shared notes.
- **Workspaces** save the tabs, panes, profiles and folders by name. Opening a workspace starts fresh terminals in the same arrangement.

## Shell integration

Shells that print the standard prompt marks give Keeper extra features:

- a green or red mark beside each command;
- the exit code and how long the command took;
- jumping between commands (⌘↑ / ⌘↓, or Ctrl+Shift+↑ / ↓);
- the current folder, used for sister terminals, *Show folder* and *Open folder in…*.

Escape codes Keeper reads:

- **OSC 133**: prompt and command marks.
- **OSC 7**: the current folder.
- **OSC 9 and OSC 777**: notifications, shown in the Island.
- **OSC 8**: links, which can be clicked.

Terminal settings → Profiles → *Shell integration…* shows a short snippet to add to bash, zsh, fish or PowerShell.

## Triggers

A trigger watches a terminal's output for a pattern (a regular expression) and highlights it, notifies you, or raises an Island alert.

- The built-in trigger notices a program waiting for an answer: `(y/n)`, `[Y/n]`, "waiting for input"…
- Each trigger fires at most once every 15 seconds.
- Output is checked as plain text, with colours and escape codes removed.

## Files on the other end

The **Files** panel connects to:

- an SSH host over SFTP, using the agent, the key named in `~/.ssh/config`, or a standard key in `~/.ssh`;
- an FTP or FTPS server.

You can browse, download, upload (button, or drag files onto the panel), create folders, rename and delete. Passwords are kept only in the system keychain, never in Keeper's own files.

## Web tools

The **New terminal ▾** menu can start:

- **Notebooks**: needs a notebook server installed, for example `pip install jupyterlab`.
- **Code editor**: needs a code editor whose command line can `serve-web`, or a code-editor server, on your `PATH`.

The server starts **in a terminal**, so you can see it and answer anything it asks. It listens only on this computer, and Keeper gives it a random token. Once it prints its address, the page opens in a pane inside Keeper.

*Web page on this computer…* opens any `localhost` address in a pane.

**Limit:** desktop development apps can't be shown inside another app's window. Add them under Terminal settings → *Open folder in…* (a command with `{path}`), and Keeper opens the terminal's folder in them, beside Keeper.

## What has been tested

- **Unit tests**:
  - profiles and isolated config folders;
  - shell detection (`/etc/shells`, WSL's UTF-16 output, `where`), the output ring buffer;
  - shell-integration parsing, the split-pane layout, keyboard shortcuts, `~/.ssh/config` parsing;
  - the socket protocol, triggers, colour-scheme contrast, and translations.
- **The session host** as a real process with real pseudo-terminals:
  - output with offsets, several viewers, resizing;
  - refusing a wrong token;
  - saving and restoring scrollback.
- **The real app on Linux** (`test/e2e/terminal.cjs`, under a virtual display):
  - running commands, splitting, a separate-sign-in profile, broadcasting;
  - leaving the page and coming back, the separate window;
  - idle CPU, stopping the host and restoring;
  - a notebook server shown in a pane;
  - SFTP listing and download against a local SSH server.
- **The packaged Linux app**: its host runs terminals from inside the app archive.

Not yet checked on real hardware:

- **Windows**: the PowerShell, Command Prompt, WSL and Git Bash detection is unit-tested, but nothing has run on a real Windows machine.
- **macOS**: nothing has run on a real Mac.
- **The code editor's web server**: not installed here, so that path was not run.

## Agents

Agents use Keeper's terminals through MCP tools served by `keeper mcp`, the agent-to-agent layer, the command line and the **Agents** view in the Terminal window. Turn it off under *Features → Agent hub*.

**Terminal tools**: `term_create` (parent, group, time limit, headless), `term_run` (wait for exit, a pattern or nothing; stdin; timeout with interrupt), `term_read`, `term_write`, `term_keys`, `term_wait`, `term_list`, `term_snapshot`, `term_resize`, `term_close` (closes sub-workers too), `term_show` (shows it to you, optionally handing it over).

**Hub tools**: `hub_whoami`, `hub_list_agents`, `hub_set_status`, `hub_send`, `hub_ask`, `hub_inbox`, `hub_post`, `hub_read`, `hub_rooms`, `hub_post_task`, `hub_tasks`, `hub_claim`, `hub_complete`, `hub_handoff`, `hub_lock`, `hub_unlock`, `hub_locks`, `hub_scratch_put`, `hub_scratch_get`, `hub_wait`.

From a shell:

```bash
keeper term run "npm test"
keeper term list
keeper hub agents
keeper hub post general "@reviewer ready for review"
```

**Identity**: agents Keeper starts get `KEEPER_AGENT_TOKEN` and `KEEPER_SESSION`; `keeper mcp` presents them, so every call is tied to one agent (harness, account/profile, terminal). Other apps that connect are asked about once.

**The bridge**: for agents without MCP, Keeper waits until the agent's prompt is idle, types the message, presses Enter after a short pause, waits for it to finish and sends the answer back as a reply. Messages queue; agents are never interrupted mid-work.

**Safety**: permission to use terminals (once, always or never per agent); risky commands (deleting, force-pushing, administrator commands, piping downloads into a shell, publishing, changing live systems) always ask; allow and deny lists and folders agents must stay in, under *Rules*; per-agent permissions (send, receive, tasks, handoff, terminals, same account only); transcripts kept 14 days; a 🤖 badge on agent tabs; **Stop all**; take over / hand back.

**Limits** (defaults): 12 terminals per agent, a 2-hour time limit (at most 24 hours), 30 minutes per command, 16,000 characters of output per call (the full output is saved to a file).

**Editor helpers for people**: quick fixes after a failed command, sticky scroll, *Run recent command* (Ctrl+Alt+R), suggestions (Ctrl+Space), `file:line:col` links that open in your editor (*Settings → Editor command*), git commit ids that run `git show`, loading a folder's `.env` per profile, and screen-reader mode.

Checked: 24 automated tests with a real session host and bash, and an end-to-end run of the app with three stand-in agents of different kinds (`test/e2e/agentterm.cjs`). Not checked: real agent programs talking through the hub, Windows and macOS shells. See [TERMINAL-RESEARCH.md](TERMINAL-RESEARCH.md).
