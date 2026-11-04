<!-- SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0 -->
# Automation

Everything Keeper can be asked to do from outside comes from one list (`core/automation.ts`). The same actions work from a terminal, a script, PowerShell, AppleScript, Shortcuts, the Linux session bus and plain `keeper://` links, so an action added once works everywhere. The table at the end of this page is made from that list.

Every action ends as a `keeper://` link that the running Keeper opens. If Keeper is not running, the system opens the link and Keeper starts.

## From a terminal: `keeper do`

```bash
keeper do --list                                   # every action
keeper do focus --minutes 25                       # start a focus timer
keeper do send.task --title "Call the plumber"     # a task, without opening anything
keeper do send.event --title "Lunch with Ana" --when "friday 1pm"
keeper do catch --text "Ideas for the garden"      # into the Inbox
keeper do ask "when does my passport expire?"      # a bare word fills the first argument
keeper do focus --minutes 25 --json                # {"ok":true,"action":"focus","link":"keeper://focus?minutes=25"}
```

A wrong name or a missing argument is said plainly (`Send to Task needs title (a short title).`) and the command ends with an error, so scripts can check it.

## Windows: PowerShell

**Settings → Works with your computer → PowerShell commands → Add commands** writes `Keeper.psm1` into `Documents\WindowsPowerShell\Modules\Keeper` and `Documents\PowerShell\Modules\Keeper` (this account only, no administrator rights). Then:

```powershell
Import-Module Keeper
Get-Command -Module Keeper
Start-KeeperFocus -Minutes 25
Send-KeeperSendTask -Title "Call the plumber"
Invoke-KeeperAction focus @{ minutes = 25 }
```

Each command opens its `keeper://` link (values are escaped), so the module needs nothing else installed. `keeper://` links themselves have worked on Windows since the installer registered them.

## macOS: AppleScript and Shortcuts

Keeper answers the links it is sent, so any script can run an action:

```applescript
tell application "Keeper" to open location "keeper://focus?minutes=25"
```

**Settings → Works with your computer → AppleScript → Copy an example** copies working lines. In Shortcuts, use **Open URLs** with a `keeper://` link, or **Run Shell Script** with `keeper do …`. The Siri and Shortcuts actions that come with Keeper (`native/macos/KeeperIntents`) open the same links.

Keeper does not ship its own AppleScript dictionary: an Electron app cannot answer AppleScript's own commands, so scripts use links instead.

## Linux: the session bus

`org.ashfordeou.Keeper.Actions` at `/org/ashfordeou/Keeper/Actions` lists the same actions (`ListActions`) and runs them (`Run(id, params)`), plus `Ask` (returns the answer) and `Search` (returns paths):

```bash
gdbus call --session --dest org.ashfordeou.Keeper.Actions --object-path /org/ashfordeou/Keeper/Actions \
  --method org.ashfordeou.Keeper.Actions.Run focus "{'minutes': <'25'>}"
```

## Every action

<!-- actions:start -->
### Find

| Action | What it does | Takes | Example |
| --- | --- | --- | --- |
| **ask** · Ask Keeper | Ask about your files; the answer opens in Keeper. | `question`: your question | `keeper do ask --question "when does my passport expire?"` |
| **search** · Search files | Open Keeper with a search. | `query`: words to find | `keeper do search --query "invoices from last month"` |

### Pages

| Action | What it does | Takes | Example |
| --- | --- | --- | --- |
| **open-page** · Open a Keeper page | Opens a page by name. | `page`: home, health, cleanup, settings… | `keeper do open-page --page cleanup` |
| **settings** · Open Settings | Opens Settings, at a section if you give one. | `section` (optional): general, appearance, accessibility… | `keeper do settings` |

### Focus

| Action | What it does | Takes | Example |
| --- | --- | --- | --- |
| **focus** · Start a focus timer | Starts the focus timer; 0 minutes stops it. | `minutes` (optional): how long | `keeper do focus --minutes 25` |

### Computer

| Action | What it does | Takes | Example |
| --- | --- | --- | --- |
| **lock-all** · Lock folders | Locks again every folder unlocked in Keeper. | — | `keeper do lock-all` |
| **automation** · Run an automation | Runs one of your Automations by its name. | `name`: the automation’s name | `keeper do automation --name "Tidy downloads"` |
| **awake** · Keep the computer awake | Keeps the computer awake for a while. | `minutes` (optional): how long | `keeper do awake --minutes 90` |
| **terminal** · Open the Terminal | Opens Keeper’s Terminal, in a folder if you give one. | `cwd` (optional): a folder (full path) | `keeper do terminal` |

### Screen

| Action | What it does | Takes | Example |
| --- | --- | --- | --- |
| **capture** · Copy text from the screen | Select an area; its text is copied. | — | `keeper do capture` |
| **screenshot** · Take a screenshot | An area, a window or the whole screen. | `mode` (optional): area, window or full | `keeper do screenshot` |
| **dictation** · Start or stop dictation | Starts dictation, or stops it when it is on. | — | `keeper do dictation` |
| **stage** · Stage mode on or off | A clean screen for presenting. | — | `keeper do stage` |

### Catch and send

| Action | What it does | Takes | Example |
| --- | --- | --- | --- |
| **catch** · Catch something | Puts words or a link in the Inbox to sort later; with nothing, opens the card. | `text` (optional): what to keep | `keeper do catch --text "Ideas for the garden"` |
| **send.note** · Send to Note | Add to today’s note. | `title`: a short title<br>`text` (optional): more words<br>`url` (optional): a web link<br>`path` (optional): a file (full path) | `keeper do send.note --title "Call the plumber"` |
| **send.task** · Send to Task | A task that links back. | `title`: a short title<br>`text` (optional): more words<br>`url` (optional): a web link<br>`path` (optional): a file (full path) | `keeper do send.task --title "Call the plumber"` |
| **send.event** · Send to Event | Into your calendar. | `title`: a short title<br>`text` (optional): more words<br>`url` (optional): a web link<br>`path` (optional): a file (full path)<br>`when` (optional): a day or time, like “friday 3pm” | `keeper do send.event --title "Lunch with Ana" --when "friday 1pm"` |
| **send.mail** · Send to Mail | A new message with it. | `title`: a short title<br>`text` (optional): more words<br>`url` (optional): a web link<br>`path` (optional): a file (full path) | `keeper do send.mail --title "Call the plumber"` |
| **send.ai** · Send to AI | Ask about it. | `title`: a short title<br>`text` (optional): more words<br>`url` (optional): a web link<br>`path` (optional): a file (full path) | `keeper do send.ai --title "Call the plumber"` |
| **send.shelf** · Send to Shelf | Keep it on the Island. | `title` (optional): a short title<br>`text` (optional): more words<br>`url` (optional): a web link<br>`path`: a file (full path) | `keeper do send.shelf --path /Users/me/Documents/plan.pdf` |
| **send.cue** · Send to Cue | A reminder where you need it. | `title`: a short title<br>`text` (optional): more words<br>`url` (optional): a web link<br>`path` (optional): a file (full path) | `keeper do send.cue --title "Call the plumber"` |
<!-- actions:end -->

## For developers

- The list, checking arguments (`actionLink`), `keeper do`'s words (`parseDo`), Send to links (`sendFromLink`), the PowerShell module and AppleScript lines: `core/automation.ts`. Tests: `test/automation.test.ts`, which also keeps the table above in step (`ACTIONS_DOC=write npx vitest run test/automation.test.ts` rewrites it).
- The command's socket methods `keeper/do` and `keeper/actions`, and writing the PowerShell module: `electron/services/automation.ts`.
- The session bus: `electron/services/platform/dbus-actions.ts` (tested against a real `dbus-daemon` in `test/dbus-actions.test.ts`).
- Adding an action: add it to `ACTIONS` with the `keeper://` link that does it (and handle the link in `electron/main.ts` if it is new), then rewrite the table.
