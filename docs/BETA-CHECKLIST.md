<!-- SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0 -->
# Beta test checklist

Thank you for testing Keeper. This page is a step-by-step list for people with a Mac or a
Windows PC. It starts with a 15-minute smoke test that everyone should run. After that,
pick the areas that suit your computer and the time you have.

Everything below has been built and checked on Linux, but nobody has run it on a real Mac
or PC yet. The list comes from every "not verified" note in the docs, so what you find here
is exactly what we cannot find ourselves.

How to install a beta and switch on beta updates: [BETA.md](BETA.md).

## Before you start

### Which computers we need

Tell us which one you used in every report. All of them are useful, and the rarer ones help most.

| Computer | Why it matters |
| --- | --- |
| Mac with Apple silicon **and a notch** (MacBook Pro 14"/16" 2021 and later, MacBook Air M2 and later) | The Island sits around the notch |
| Mac with Apple silicon, **no notch** (Mac mini, iMac, Mac Studio, MacBook Air M1, any Mac on an external display) | The Island draws its own pill |
| Mac with an **Intel** processor | Separate build (x64), no Apple Intelligence |
| **Windows 11 Home** and **Windows 11 Pro** | Pro has Remote Desktop hosting, BitLocker and Group Policy; Home does not |
| **Windows 10 Home** and **Windows 10 Pro** (22H2) | Older taskbar, older notification and OCR APIs |
| Windows on ARM (optional) | Runs the x64 build under emulation |

Some items name the hardware they need, such as a laptop lid, a second monitor, an external
monitor with DDC/CI, a phone or a second computer. Skip any item you can't do.

### Where the logs are

Most items ask for the same three things:

1. **Keeper's report.** Settings → **Keeper's processes** → **Copy report**. It copies the
   Keeper version, the system and processor, whether safe mode is on and the last 60
   problems Keeper noted. Paste it into the bug report.
2. **Crash reports.** On the same page, **Crash reports (N)** opens the folder when there are any.
   Zip it and attach it.
3. **Keeper's data folder**, which holds `session/log.jsonl` (the problem log) and `Crashpad/` (crash dumps):

   | System | Folder |
   | --- | --- |
   | macOS | `~/Library/Application Support/Keeper` |
   | Windows | `%APPDATA%\Keeper` |
   | Linux | `~/.config/Keeper` |

For more detail, start Keeper from a terminal with logging switched on. It writes everything
the app prints:

```sh
# macOS (Terminal)
/Applications/Keeper.app/Contents/MacOS/Keeper --enable-logging 2>&1 | tee ~/keeper-console.txt
```

```powershell
# Windows (PowerShell)
& "$env:LOCALAPPDATA\Programs\Keeper\Keeper.exe" --enable-logging --log-file="$env:USERPROFILE\keeper-console.txt"
```

Keeper's native helpers have their own logs:

- **macOS:** open Console.app, choose your Mac, and search for `keeper-helper` (Apple Intelligence,
  Live Text, Spotlight, the Island's notifications and calls, voice) or `Keeper Intents`
  (Siri and Shortcuts).
- **Windows:** Event Viewer → Windows Logs → Application, filtered by the source `Keeper` or
  `Application Error`.

Before you attach a log, read it through: it can contain file and folder names.

### Reporting a problem

Open a **Beta bug** issue (the template asks for everything we need):
<https://github.com/ashfordeOU/keeper/issues/new?template=beta-bug.yml>. Put the item's ID (like
`AWAKE-2`) in the title. If an item works, tick its box. If you're testing for us directly,
you can send your ticked copy of this page.

### How items are written

Each item has:

- **Needs:** what you need before you start.
- **Steps:** what to do.
- **Expected:** what should happen.
- **Logs:** what to attach if it doesn't happen.

Unless an item says otherwise, the logs to attach are *Keeper's report*.

---

## 15-minute smoke test

Run this first on every computer you test, and again after each beta update. It covers what
everything else depends on.

- [ ] **SMOKE-1 Install and first launch** (3 min)
  - **Needs:** the beta installer for your system ([BETA.md](BETA.md)).
  - **Steps:** Install Keeper. On macOS, open the `.dmg` and drag Keeper to Applications. On
    Windows, run `Keeper-setup-x64.exe`. Then open Keeper. If macOS or Windows warns about an
    unidentified developer, follow README → First launch.
  - **Expected:** the welcome tour opens. You can step through it, and the usage-stats screen
    shows its switch. Keeper's window opens on Home.
  - **Logs:** a screenshot of any warning, plus the console log (see above).

- [ ] **SMOKE-2 Library and search** (3 min)
  - **Needs:** a few documents, pictures and a screenshot in your usual folders.
  - **Steps:** Wait for the first scan to finish, which shows on Home. Search `screenshots from
    this week`, then a word that only appears inside one of your PDFs.
  - **Expected:** both searches find the right files. Quick Look (<kbd>Space</kbd>) shows a preview.
  - **Logs:** Keeper's report. On macOS, also say whether Keeper asked for Desktop, Documents and
    Downloads access, and what you answered.

- [ ] **SMOKE-3 Text in pictures** (2 min)
  - **Steps:** Take a screenshot of some text. Wait about a minute, then search for a word in it.
  - **Expected:** the screenshot is found by its text.

- [ ] **SMOKE-4 The Island** (2 min)
  - **Steps:** Look at the top of the main screen. Hover over the Island, then drop a file on it.
    Play music in any app.
  - **Expected:** on a Mac with a notch the Island hugs the notch. Everywhere else it is a pill
    at the top centre. It is never cut off and never covers the menu bar's icons. The file lands
    on the shelf, and the song shows with play and pause.
  - **Logs:** a screenshot of the top of the screen, your screen setup (scaling, how many
    displays, where the menu bar or taskbar is), and the Mac model.

- [ ] **SMOKE-5 Tray, shortcuts and the palette** (2 min)
  - **Steps:** Close Keeper's window. Use the menu-bar icon (macOS) or the tray icon (Windows)
    to open it again. Press <kbd>Ctrl/Cmd Shift Space</kbd> anywhere for Quick Search, and
    <kbd>Ctrl/Cmd K</kbd> in Keeper for the command palette.
  - **Expected:** the icon is there and is the right colour in light and dark menu bars and
    taskbars. Both shortcuts open. On Windows, the tray icon may sit in the overflow (^) area.

- [ ] **SMOKE-6 Updates and the report** (2 min)
  - **Steps:** Settings → Updates: check **Include beta versions** is on (a beta copy follows betas by itself unless you switched this off by hand), then **Check now**. Then
    Settings → Keeper's processes → **Copy report** and paste it anywhere.
  - **Expected:** the check finishes without an error ("up to date" or a newer beta). The report
    has the version, system and processor.

- [ ] **SMOKE-7 Quit and start again** (1 min)
  - **Steps:** Quit from the menu (macOS: Keeper → Quit; Windows: tray → Quit). Open Keeper again.
  - **Expected:** it quits fully, with no Keeper processes left in Activity Monitor or Task
    Manager after 10 seconds. It opens again with your tabs, and no "Keeper stopped unexpectedly"
    banner.

---

## 1. Install, updates and recovery (about 30 minutes)

- [ ] **INST-1 Update from one beta to the next** (10 min)
  - **Needs:** an older beta installed, with **Include beta versions** on, and a newer beta
    published.
  - **Steps:** Settings → Updates → **Check now** → **Download** → **Restart and update**.
  - **Expected:** the newer beta downloads with progress and installs. Keeper opens on the new
    version (see Settings → About) and shows "What's new" once. On macOS the app stays in
    /Applications, and on Windows in `%LOCALAPPDATA%\Programs\Keeper`.
  - **Logs:** Keeper's report, plus a screenshot of the Updates page. Windows: also
    `%LOCALAPPDATA%\keeper-updater\` if it exists.

- [ ] **INST-2 Watchdog restart after a crash** (5 min). See [RESILIENCE.md](RESILIENCE.md).
  - **Steps:** Note Keeper's process ID, then force-quit only the main process. On macOS, use
    Activity Monitor → Keeper → Force Quit. On Windows, use Task Manager → Details → the
    `Keeper.exe` with the largest memory → End task. Wait 5 seconds.
  - **Expected:** Keeper starts again by itself within a few seconds, and a banner says your tabs
    are back.
  - **Logs:** Keeper's report, plus the `session` folder from Keeper's data folder.

- [ ] **INST-3 Safe mode after repeated crashes** (5 min)
  - **Steps:** Do INST-2 three times within five minutes.
  - **Expected:** the third restart is in **safe mode**, with only the library on and your tabs
    kept. **Start normally** restarts cleanly.

- [ ] **INST-4 No leftover helpers** (5 min)
  - **Steps:** Use Keeper for a few minutes (search, convert a video, open a terminal tab), then quit.
  - **Expected:** within 10 seconds no `Keeper`, `keeper-helper`, `ffmpeg`, `rclone` or `powershell`
    processes started by Keeper are left.
  - **Logs:** a screenshot of Activity Monitor or Task Manager showing what is left.

- [ ] **INST-5 Links and file types** (5 min)
  - **Steps:** Open `keeper://quick` from a browser's address bar or the Run box. Double-click
    a `.rdp` file and a `.vnc` file. You can save the connection from Remote Desktops →
    Export to make one.
  - **Expected:** the link opens Quick Search. The files open in Keeper's Remote Desktops (Keeper
    is offered in "Open with", and never takes over as the default without asking).

---

## 2. Island, Cues and Island+ (about 40 minutes)

See [ISLAND-CUES.md](ISLAND-CUES.md).

- [ ] **ISL-1 Notifications in the Island** (macOS, Windows; 5 min)
  - **Needs:** Island settings → **Show other apps' notifications**: on. On Windows, allow
    Keeper's notification access when it asks.
  - **Steps:** Send yourself a message in a chat app, or make any app show a notification.
  - **Expected:** the notification also shows in the Island. On Windows, if the listener isn't
    allowed, Keeper falls back to the notification history and says so.
  - **Logs:** Keeper's report. macOS: Console.app, `keeper-helper`.

- [ ] **ISL-2 Front window reporting for Cues** (macOS, Windows; 10 min)
  - **Steps:** Make a Cue tied to an app (for example your mail app), and one tied to a website.
    Switch to that app, then open that site in your browser.
  - **Expected:** the Cue pops up beside the window each time. On macOS, Keeper asks for
    Accessibility or Automation the first time, and the dialog names Keeper.
  - **Logs:** Keeper's report, plus the browser and its version.

- [ ] **ISL-3 Calls and microphone muting** (macOS, Windows; 10 min)
  - **Needs:** a call app (Zoom, Teams, Meet in a browser) and a test call.
  - **Steps:** Start a call. Use the Island's mute button, then mute with the app's own shortcut.
  - **Expected:** the Island shows a call timer. Its mute button mutes the microphone (the other
    side stops hearing you), and the state stays in step with the app's own mute.
  - **Logs:** Keeper's report, plus the call app and its version.

- [ ] **ISL-4 Volume and brightness levels** (macOS, Windows; 5 min)
  - **Steps:** Change the volume and the screen brightness with the keyboard keys.
  - **Expected:** Keeper's level shows in the Island beside the system's own pop-up, and the
    numbers match.

- [ ] **ISL-5 Windows text recognition engine** (Windows; 5 min)
  - **Steps:** Screenshots and recording → Capture options → **Reader**: *The system's
    recognizer*. Then use Copy Text from Screen on some text.
  - **Expected:** the text is recognised and copied.

- [ ] **ISL-6 Island placement** (all Macs, Windows with two monitors; 5 min)
  - **Steps:** Connect or disconnect an external display, change the scaling, and move the
    menu bar or taskbar to another screen.
  - **Expected:** the Island moves with the main screen and is never off-screen or doubled.

---

## 3. Keep Awake (about 30 minutes)

See [KEEP-AWAKE.md](KEEP-AWAKE.md).

- [ ] **AWAKE-1 Siri and Shortcuts actions** (macOS; 5 min)
  - **Steps:** In Shortcuts, add "Keep the Mac Awake", run it, then run "Let the Mac Sleep Again".
    Also ask Siri to "Keep the Mac awake with Keeper".
  - **Expected:** the actions are listed under Keeper, and a session starts and stops (the cup
    in the menu bar and the Island show it).
  - **Logs:** Console.app, `Keeper Intents`.

- [ ] **AWAKE-2 Closed-lid mode** (Mac laptops, Windows laptops; 10 min)
  - **Needs:** a laptop on power; an external display if you have one.
  - **Steps:** Start Keep Awake with **closed-lid mode** on. Close the lid for 2 minutes while a
    download or music plays.
  - **Expected:** the computer stays awake (music keeps playing). On battery, or when it gets
    hot, the safety rules end the session. After it ends, closing the lid sleeps again as usual.
  - **Logs:** Keeper's report. macOS: the output of `pmset -g assertions` while it's on. Windows:
    `powercfg /requests`.

- [ ] **AWAKE-3 Move the pointer now and then** (macOS, Windows; 5 min)
  - **Steps:** Switch on **Nudge the pointer** for a session and wait 5 minutes without touching
    anything.
  - **Expected:** the pointer moves one point and back, and chat apps don't show you as away.
    macOS asks for Accessibility first.

- [ ] **AWAKE-4 Lock the screen when a session ends** (macOS, Windows; 5 min)
  - **Steps:** Start a 1-minute session with **Lock the screen when a session ends** on.
  - **Expected:** the screen locks (macOS: the display sleeps and asks for your password).

- [ ] **AWAKE-5 Time left in the menu bar** (macOS; 5 min)
  - **Steps:** Start a 30-minute session.
  - **Expected:** the time left shows next to the menu-bar icon and counts down every 30
    seconds. It isn't hidden behind the notch; if there is no room, macOS hides it, which is fine.

---

## 4. Stage mode (about 30 minutes)

See [STAGE.md](STAGE.md). Stop Stage after each test and check that everything is back as it was.

- [ ] **STAGE-1 Clean screen on macOS** (macOS; 15 min)
  - **Steps:** Start Stage with every option on, then stop it.
  - **Expected:** while it runs, desktop icons, the Dock and the menu bar are hidden, the alert
    volume is muted and other apps are hidden. The display mode switches if you asked. Keeper's
    windows are protected from capture where you asked. When you stop, everything comes back,
    including Finder's desktop.
  - **Logs:** Keeper's report, the `stage` folder in Keeper's data folder (the journal of old
    values), and Console.app, `keeper-helper`.

- [ ] **STAGE-2 Clean screen on Windows** (Windows; 10 min)
  - **Steps:** Start Stage with every option on, then stop it.
  - **Expected:** desktop icons are hidden, the taskbar auto-hides, toasts and sounds are off, and
    the pointer size changes if you asked. Other windows minimise and come back afterwards.
  - **Logs:** as STAGE-1, plus a screenshot of Settings → Personalization → Taskbar after stopping.

- [ ] **STAGE-3 Recovery after a crash during Stage** (macOS, Windows; 5 min)
  - **Steps:** Start Stage, then force-quit Keeper as in INST-2.
  - **Expected:** the watchdog puts your settings back, or the next start does and says so.

- [ ] **STAGE-4 Start by itself when recording** (macOS, Windows; 5 min)
  - **Needs:** Stage → Start when the screen is captured: on.
  - **Steps:** Start a recording in QuickTime, OBS or the Snipping Tool, then stop it.
  - **Expected:** Stage starts and ends with the recording. If your recorder isn't noticed,
    tell us which one.

---

## 5. Ambience: live wallpaper, sound and folder icons (about 25 minutes)

See [AMBIENCE.md](AMBIENCE.md).

- [ ] **AMB-1 Live wallpaper behind the icons** (macOS, Windows; 10 min)
  - **Steps:** Ambience → choose an animated scene. Show the desktop.
  - **Expected:** the scene plays behind the desktop icons and is never over your windows. It
    pauses when the screen locks. If macOS draws its own picture above it, **Options → Always
    use a still picture** gives a still frame instead.
  - **Logs:** Keeper's report, a screenshot, and the macOS version or Windows build.

- [ ] **AMB-2 Restore the wallpaper** (macOS, Windows; 5 min)
  - **Steps:** Switch the live wallpaper off.
  - **Expected:** your previous wallpaper is back exactly, on every display.

- [ ] **AMB-3 Ambient sound** (macOS, Windows; 5 min)
  - **Steps:** Open the mixer, play rain and café together, and set a 1-minute sleep timer.
  - **Expected:** you hear both, the volumes respond, and the sound fades out at the timer.

- [ ] **AMB-4 Custom folder icons** (macOS, Windows; 5 min)
  - **Steps:** Give a folder a colour and symbol, look at it in Finder or Explorer, then restore it.
  - **Expected:** the icon shows (Explorer may need a refresh) and the restore is exact. On
    Windows, `desktop.ini` is hidden and removed again.

---

## 6. Dictation and meetings (about 35 minutes)

See [VOICE.md](VOICE.md).

- [ ] **VOICE-1 Hold a key to talk** (macOS, Windows; 10 min)
  - **Steps:** Dictation → Hold a key to talk: on. In a text editor, hold the key (right Option or
    Ctrl), speak a sentence and let go.
  - **Expected:** live words show in the pill, and the finished text appears where your cursor
    is. macOS asks for Input Monitoring and Accessibility first.
  - **Logs:** Keeper's report. macOS: Console.app, `keeper-helper`.

- [ ] **VOICE-2 Never types into a password field** (macOS, Windows; 5 min)
  - **Steps:** Put the cursor in a password field (a browser login page) and dictate.
  - **Expected:** nothing is typed. Keeper says it won't type into password fields.

- [ ] **VOICE-3 Microphone state** (macOS; 3 min)
  - **Steps:** Dictate while another app is using the microphone.
  - **Expected:** the Island and the pill show the microphone as in use. No sound is lost.

- [ ] **VOICE-4 Meeting recording with the computer's sound** (macOS, Windows; 10 min)
  - **Steps:** Meetings → Record. Play a video with speech, and speak yourself.
  - **Expected:** both voices are in the transcript, speakers are told apart, and notes are
    written when you stop. macOS asks for Screen Recording (for the computer's sound).

- [ ] **VOICE-5 The large speech model** (optional, 10 min, needs about 1.6 GB free)
  - **Steps:** Dictation → model **Large v3 turbo**. Dictate a sentence.
  - **Expected:** it downloads once, is checked, and recognises speech.

- [ ] **VOICE-6 Siri dictation intent** (macOS; 2 min)
  - **Steps:** In Shortcuts, find Keeper's dictation actions and run one.
  - **Expected:** it starts dictation in Keeper.

---

## 7. System monitor (about 25 minutes)

See [MONITOR.md](MONITOR.md).

- [ ] **MON-1 Readings on macOS** (macOS; 10 min)
  - **Steps:** Open Health and Processes. Switch on Live readings in the menu bar.
  - **Expected:** processor, memory, GPU, battery and power readings look plausible (compare
    with Activity Monitor). Energy impact shows per app. The menu-bar item is crisp in light and
    dark. Listening ports and signatures show for running apps.
  - **Logs:** Keeper's report, plus screenshots beside Activity Monitor.

- [ ] **MON-2 Readings on Windows** (Windows; 10 min)
  - **Steps:** As MON-1. Also open the per-app volume mixer.
  - **Expected:** GPU use matches Task Manager. On laptops, battery rate and fans show. Signatures
    show as signed or unsigned, and listening ports have their app. The mixer changes an app's volume.

- [ ] **MON-3 Containers** (optional; 5 min; Docker Desktop or Podman)
  - **Expected:** containers are listed with processor and memory use, and stop and start work.

---

## 8. To do and guides (about 20 minutes)

See [GUIDE.md](GUIDE.md).

- [ ] **GUIDE-1 Every system link opens the right page** (macOS, Windows; 15 min)
  - **Steps:** Open To do → **How do I…?** and try ten different topics, for example camera,
    microphone, storage, backups, updates, firewall, notifications, startup apps, privacy and
    display. Use **Open** on each.
  - **Expected:** each opens the right page in System Settings or Windows Settings. Note any
    that open the wrong page or nothing, with the topic's name.

- [ ] **GUIDE-2 Storage Sense and phone backups** (Windows / macOS; 5 min)
  - **Expected:** on Windows, To do knows whether Storage Sense is on. Phone backups (iPhone
    backups from Finder or iTunes) show their real size.

---

## 9. Working with the system's assistants (about 30 minutes)

See [AI-SYSTEM.md](AI-SYSTEM.md) and [PLATFORM.md](PLATFORM.md).

- [ ] **SYS-1 Siri, Shortcuts and Spotlight** (macOS; 10 min)
  - **Steps:** Ask Siri "Search files with Keeper". In Shortcuts, run **Ask Keeper**. Search
    Spotlight for one of Keeper's actions and for a file Keeper indexed.
  - **Expected:** all of these work and return results. Shortcuts shows the actions under Keeper.
  - **Logs:** Console.app, `Keeper Intents` and `keeper-helper`.

- [ ] **SYS-2 Apple Intelligence as Keeper's AI** (macOS 26 with Apple Intelligence on, Apple silicon; 5 min)
  - **Steps:** Settings → AI & Brain → choose Apple's on-device model. Ask the Assistant a question.
  - **Expected:** an answer arrives with no network use. Writing Help (right-click in a text
    field) also works.

- [ ] **SYS-3 Computer use** (macOS, Windows; 10 min)
  - **Needs:** an AI connection with a model that can use a computer.
  - **Steps:** Ask the Assistant to open the Calculator and add two numbers.
  - **Expected:** Keeper asks before acting. The pointer and keys go to the right place, Esc
    stops it, and on macOS it asks for Accessibility first.

- [ ] **SYS-4 Explorer, Jump List and Copilot** (Windows; 5 min)
  - **Steps:** Right-click a folder → **Search with Keeper**. Right-click Keeper on the taskbar.
    On Windows 11 build 26220 or later, check Settings → AI agents.
  - **Expected:** the menu item opens Quick Search in that folder (on Windows 11 it may be under
    "Show more options"), and the Jump List shows Keeper's actions. Keeper is listed as an agent
    tool where Windows supports it.

---

## 10. AI providers, agents and terminals (about 30 minutes)

See [AGENTS.md](AGENTS.md), [TERMINAL-RESEARCH.md](TERMINAL-RESEARCH.md) and [TERMINAL.md](TERMINAL.md).

- [ ] **AI-1 Real providers** (any system; 10 min; your own API key)
  - **Steps:** Connect one provider you have a key for and ask the Assistant something.
  - **Expected:** a streamed answer arrives. A wrong key gives a plain error. Tell us which
    provider and model you used.

- [ ] **AI-2 Terminals on Windows and macOS** (macOS, Windows; 10 min)
  - **Steps:** Open a terminal tab: zsh on macOS; PowerShell and cmd.exe on Windows. Run a few
    commands, including one that fails.
  - **Expected:** each command is its own block with its exit status, and the working folder
    follows `cd`.

- [ ] **AI-3 Coding agents through the hub** (optional; 10 min; a signed-in coding agent CLI)
  - **Steps:** Start an agent from the Agents view and give it a small task.
  - **Expected:** the Island shows when it waits for you. Risky commands wait for your approval.

---

## 11. Link, remote screens and remote access (about 60 minutes; two computers)

See [LINK.md](LINK.md), [REMOTE.md](REMOTE.md) and [MESH.md](MESH.md).

- [ ] **LINK-1 Pair two computers** (any two; 10 min)
  - **Steps:** Pair a Mac or PC with another computer through Devices → Add.
  - **Expected:** they find each other on the same network (mDNS). Pairing asks on both sides,
    and the pairing survives a restart (the key is kept in the Keychain or Credential Manager).
  - **Logs:** Keeper's report from both computers.

- [ ] **LINK-2 Direct connection across networks** (10 min; one computer at home, one elsewhere or on a phone hotspot)
  - **Expected:** the device page says **Direct** after a while, or **Relayed** if the routers
    don't allow it. Files still go both ways.

- [ ] **REM-1 Control a Mac or PC from another computer** (macOS, Windows; 15 min)
  - **Steps:** From the second computer, view and control this one.
  - **Expected:** macOS asks for Screen Recording and Accessibility once. The pointer and keys
    work, including modifier keys and non-English layouts. Sound comes through if you turned it on.
  - **Logs:** Keeper's report from both computers.

- [ ] **REM-2 Several monitors** (needs two displays; 5 min)
  - **Expected:** you can switch displays, use "all displays", and "follow the pointer" works.

- [ ] **REM-3 Unattended access** (macOS, Windows; 10 min; needs an administrator)
  - **Steps:** Switch on unattended access, restart the computer and don't log in. Connect from
    the other computer.
  - **Expected:** an administrator prompt appears once. After the restart you can reach the
    login screen. Switching it off removes the service.

- [ ] **REM-4 Help mode** (5 min)
  - **Steps:** Start a one-time help session with someone who isn't paired. They read you the code.
  - **Expected:** they see your screen, and can control it only if you allow it. Voice chat works
    both ways.

- [ ] **REM-5 Phones** (5 min; an iPhone or Android phone)
  - **Steps:** Open the companion page from the QR code in Safari or Chrome on the phone.
  - **Expected:** it connects, lists shared folders, and uploads a photo.

- [ ] **MESH-1 Keeper Mesh between two computers** (macOS, Windows; 15 min; needs an administrator)
  - **Expected:** the WireGuard network comes up after one administrator prompt (UAC on Windows,
    the LaunchDaemon on macOS). The other device answers `ping laptop.keeper`. Turning it off
    removes the routes and DNS changes.
  - **Logs:** Keeper's report. On Windows, also `Get-NetAdapter` and `Get-DnsClientNrptRule`.
    On macOS, `ls /etc/resolver` and `ifconfig`.

---

## 12. Remote Desktops (about 30 minutes)

See [REMOTE-DESKTOPS.md](REMOTE-DESKTOPS.md).

- [ ] **RDC-1 Open an RDP connection on Windows** (Windows; 5 min)
  - **Expected:** a saved RDP connection opens in `mstsc`, with the address and user filled in.

- [ ] **RDC-2 Let others reach this PC** (Windows **Pro**; 10 min; needs an administrator)
  - **Steps:** Remote Desktops → Let others reach this computer → switch on Remote Desktop.
  - **Expected:** the plan lists the registry and firewall changes before it runs. After it
    runs, Remote Desktop is on in Windows Settings. Switching it off reverses it. On Windows
    **Home**, Keeper says hosting needs Pro.

- [ ] **RDC-3 Open an RDP or VNC connection on macOS** (macOS; 5 min)
  - **Expected:** `.rdp` opens in Windows App (or Microsoft Remote Desktop) if it's installed;
    VNC opens in Keeper or Screen Sharing.

- [ ] **RDC-4 Screen Sharing on this Mac** (macOS; 5 min; needs an administrator)
  - **Expected:** switching on screen sharing asks for the password once and turns it on in
    System Settings → General → Sharing.

- [ ] **RDC-5 PowerShell remoting and serial** (optional; 5 min)
  - **Expected:** a `pwsh` session to another Windows PC opens in a terminal tab.

---

## 13. Places & Tracks (about 15 minutes)

See [TRACKS.md](TRACKS.md).

- [ ] **TRK-1 Find My on a Mac** (macOS 13 to 15; 5 min)
  - **Expected:** your AirTags or devices appear in Live (it may ask for Full Disk Access).
    Tell us your macOS version, because the file format changed in 14.4.

- [ ] **TRK-2 Passwords are encrypted by the system keychain** (macOS, Windows; 5 min)
  - **Steps:** Connect a service with a key, then quit Keeper.
  - **Expected:** `tracks` in Keeper's data folder holds no readable key. The key is in the
    Keychain or Credential Manager under Keeper.

- [ ] **TRK-3 A real sports service** (optional; 5 min; a Strava, Polar or Fitbit account)
  - **Expected:** the sign-in page opens in your browser and comes back to Keeper, and your
    activities are imported.

---

## Linux extras (optional)

These are also unverified, on real Linux hardware: real GNOME Shell docks and KDE panels with
Stage, real DDC monitors, xinput keystrokes, `/dev/input` dictation keys, PipeWire screen casts,
the Wayland portal for remote control, and the tray menu as a real desktop draws it. Use the
same report template.

---

## A diagnostics bundle (spec, not built yet)

Keeper's **Copy report** (Settings → Keeper's processes) has the version, the system and
processor, safe mode, the last 60 problems and the number of crash dumps. For beta reports we
also need the details below, so this is a small, separate feature to build.

**Copy diagnostics**, in Settings → Keeper's processes, Help → Report a problem, and the palette:

- **What it gathers:**
  - the Keeper version, edition (direct, Microsoft Store, Mac App Store) and how it was
    installed (`detectInstallSource`);
  - the system name, version and build; the processor and memory; the Mac model identifier or
    Windows edition (Home or Pro);
  - the displays: count, size, scaling, which is main, and whether there is a notch;
  - the language and the time zone offset;
  - which features are on (ids from `core/features.ts`) and whether safe mode is on;
  - the GPU from `app.getGPUFeatureStatus()`;
  - the last 200 lines of `session/log.jsonl`;
  - the names, dates and sizes (not contents) of crash dumps;
  - the helpers' status (`keeper-helper` and Keeper Intents present, signed, answering).
- **Privacy:** it never includes file names, folder names, search terms, account names, keys or
  host names. Paths in log lines are replaced with `<path>`, using the same redaction as usage
  stats in `core/telemetry.ts`.
- **What you get:** a text preview of exactly what will be copied, then two choices. **Copy**
  puts it on the clipboard as text. **Save as .zip** writes the text plus the crash dumps the
  person ticks.
- **Where it runs:** the main process gathers it, behind an IPC call `diagnostics.collect()`. No
  network. Nothing runs until the person asks.
- **Tests:** a unit test checks the redaction on log lines with paths, e-mail addresses and
  host names. An e2e test copies it and checks the fields.
