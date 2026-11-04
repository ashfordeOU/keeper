# Keeper inside your operating system

Keeper works with what your computer already offers. Each integration is
detected on start, explained in **Settings → Works with your computer**, and
can be switched off. Keeper works the same without any of them.

## Every computer

| What | How |
|---|---|
| **Any AI app (MCP)** | AI apps and editors that support the Model Context Protocol can search and read your Keeper library. **Copy setup** puts a ready-made `mcpServers` entry on the clipboard. The server runs through Keeper's own runtime, so nothing else needs installing. |
| **Ask Keeper from anywhere** | <kbd>Ctrl/⌘ Shift K</kbd> (changeable) opens Quick Search ready for a question. <kbd>Tab</kbd> switches between finding files and asking; <kbd>↩</kbd> sends the question to the assistant. |
| **Links and scripts** | `keeper://ask?q=…` opens the assistant with the question filled in; `keeper://reveal?path=…` shows a file in its folder; `keeper://search?q=…` and `keeper://open?path=…` work as before. The `keeper` command does the same from a terminal, and `keeper do <action>` runs any of Keeper's actions ([Automation](AUTOMATION.md)). Only absolute local paths are accepted. |
| **PowerShell (Windows) and AppleScript (Mac)** | The same actions as PowerShell commands (**Add commands**) and as AppleScript lines (**Copy an example**). See [Automation](AUTOMATION.md). |

## macOS

Keeper ships a small native helper, `keeper-helper`, inside the app
(`Keeper.app/Contents/MacOS/`). It talks to Keeper over its standard input and
output, one JSON message per line, and stops when it has been idle for a minute.
Its source is in [`native/macos/KeeperHelper`](../native/macos/KeeperHelper).

| What | Needs | Notes |
|---|---|---|
| **Apple Intelligence** | macOS 26, Apple silicon, Apple Intelligence switched on | Keeper's assistant can use the on-device model: no key, nothing leaves the Mac. Keeper's tools (search, read a file) are offered to the model, which calls them through the helper. The model has a small context window (about 4,000 tokens), so answers rely on Keeper's search more than on long passages. |
| **Live Text recognition** | macOS 13+ | Text in images is read with macOS's Vision framework (accurate mode, language correction, automatic language) instead of the built-in reader. Scanned PDFs still use the built-in reader. Falls back automatically. |
| **Spotlight** | macOS 13+ | Off until you switch it on. Keeper adds its own entries (name, where the file came from, tags and the start of the text Keeper read) to Spotlight, in batches, and removes them when files go away or when you switch it off. Choosing a Keeper result in Spotlight shows the file in its folder. Spotlight's own index of your disk is not touched. |
| **Shortcuts and Siri** | — | Third-party apps can only offer Shortcuts actions and Siri phrases from an app built with Xcode's App Intents; Keeper is not, yet. What works today: a shortcut that opens `keeper://ask?q=…` or runs `keeper search "…"` (steps are in Settings), which Siri runs by its name. |
| **Services menu** | — | Electron apps cannot add their own Services entry. A Shortcuts Quick Action set to “Services Menu” does the same; steps are in Settings. |

There is no Face ID on Macs and apps cannot use your Apple ID to unlock or
authenticate anything; locked folders use Touch ID or your Mac password.

## Windows

| What | Needs | Notes |
|---|---|---|
| **Windows text recognition** | Windows 10 or 11 with a recognition language installed | Uses `Windows.Media.Ocr` through Windows PowerShell. The file name goes in as a quoted literal inside a script passed with `-EncodedCommand`, so names with quotes, `$` or backticks cannot run anything. Falls back to the built-in reader. |
| **Windows AI agents** | The on-device agent registry (`odr.exe`) | **Register Keeper** writes an MCP manifest and adds it with `odr mcp add`. Where the registry is not available, any agent that accepts MCP servers can use `keeper mcp` directly. |
| **On-device Windows AI model** | A Store (MSIX) install | Windows only offers its local language model to packaged apps. Keeper is not distributed that way yet, so the slot is shown as unavailable rather than pretended. |
| **File Explorer menu** | — | Off until switched on. Adds “Search with Keeper” for folders and folder backgrounds under `HKCU\Software\Classes` (this user only, no administrator rights), and removes it when switched off. |
| **Taskbar menu** | — | Right-click Keeper on the taskbar for Search, Ask Keeper and Copy Text from Screen. |

## Linux

| What | Needs | Notes |
|---|---|---|
| **GNOME search** | GNOME Shell, a session D-Bus | Off until switched on. Installs `~/.local/share/gnome-shell/search-providers/keeper-search-provider.ini` and a D-Bus activation file, and serves `org.gnome.Shell.SearchProvider2` while Keeper runs. GNOME only shows providers whose `DesktopId` (`keeper.desktop`) is an installed app, which the .deb and .rpm packages and the install script provide; a bare AppImage needs an integration tool for it. |
| **KDE KRunner** | Plasma 5.24 or later, a session D-Bus | Off until switched on. Installs `~/.local/share/krunner/dbusplugins/keeper.desktop` and serves `org.kde.krunner1`, with a “Show in folder” action. |
| **Launcher actions** | — | Right-click Keeper in the dock or app menu for Search Files, Ask Keeper and Copy Text from Screen. |

The D-Bus client is pure JavaScript. It connects to `unix:path=` session buses
(the norm with systemd); buses on abstract sockets are not supported, and the
integrations then say so.

## What was checked, and how

- The pure pieces (what is offered where, link parsing, PowerShell quoting,
  registry arguments, D-Bus result shapes, Spotlight items, the helper's line
  protocol) have unit tests in `test/platform.test.ts`.
- The GNOME and KRunner providers are tested against a real `dbus-daemon`
  (`test/platform-dbus.test.ts`), and `test/e2e/platform.cjs` drives the real
  app on Linux: switch on, query with `gdbus` as the desktop does, switch off.
- `keeper-helper` is built and started on macOS in CI. Its use of Apple's
  frameworks (the on-device model, Vision, Core Spotlight) can only run on a Mac
  and has not been exercised by automated tests.
- The Windows pieces (OCR, Explorer menu, agent registry) have not run on
  Windows in automated tests yet; only their scripts and arguments are tested.
