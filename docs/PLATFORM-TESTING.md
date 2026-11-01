<!-- SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0 -->
# Testing on macOS and Windows

Most of Keeper is TypeScript that runs the same everywhere, and the unit tests
and Linux end-to-end tests cover it. The parts that only exist on one system
(Swift helpers on macOS, C# and PowerShell on Windows, and the system commands
whose output Keeper reads) are proven on GitHub's macOS and Windows machines
by `.github/workflows/ci.yml`. This page says what runs where, and what still
needs a real person at a real computer.

## On every push and pull request (job `test`)

| | macOS | Windows |
|---|---|---|
| Type checks, unit tests, full build, unpacked app | yes | yes |
| `keeper-helper` (Swift) builds, universal | yes | |
| `keeper-helper` answers every method that needs no permission ([scripts/ci/helper-smoke.mjs](../scripts/ci/helper-smoke.mjs)): `hello`, `language`, `ddc.list`, `stage.modes`, `stage.windows`, `stage.cursorSize`, `voice.focus`, `voice.micState`, `calls.micApps`, `calls.muted`, `hud.levels`, `place.measure`, `apps.running`, `front.now`, `notifications.status`, `desktop.getImage`, `input.status`, Live Text (`ocr`) on a drawn picture; methods that need a permission answer with a plain error instead of hanging; the helper exits when its input closes | yes | |
| `Keeper Intents.app` (Siri, Spotlight and Shortcuts actions) builds and has its App Intents metadata | yes | |
| Every piece of C# Keeper compiles at run time compiles ([scripts/ci/csharp-sources.mjs](../scripts/ci/csharp-sources.mjs), [scripts/ci/compile-csharp.ps1](../scripts/ci/compile-csharp.ps1)) | | yes |

The C# check finds every `Add-Type -TypeDefinition` and `-MemberDefinition` in
`electron/` and `core/` by reading the TypeScript the way the program sees it
(escapes applied, `${name}` filled in from the constant it names), and compiles
each one in its own Windows PowerShell 5.1, as Keeper does. That includes the
Core Audio volume mixer, SendInput and BlockInput for remote control, the
WorkerW live-wallpaper attach, the keyboard hooks for dictation and Stage, the
taskbar, desktop icon and pointer switches, display modes and brightness, job
objects and process suspension, and the Keep Awake hold. The Keeper Link
service (unattended access) is generated and built with the .NET Framework 4
`csc.exe`. Both compilers accept C# 5 only: string interpolation (`$"…"`),
`?.`, `nameof` and expression-bodied members fail here before they fail on
someone's PC. It also loads every .NET assembly the scripts name and every
Windows Runtime type they use (notifications listener, media sessions, OCR,
Windows Hello, radios).

## On pushes to main and manual runs (job `native-e2e`)

Started from the Actions tab (Run workflow) or by a push to `main`; skipped for
pull requests to keep them quick.

**Keeper's own read-only commands against the machine** ([test/native/system-probe.ts](../test/native/system-probe.ts)):

- listening ports (Get-NetTCPConnection and Win32_Process; lsof) find the test's own server and process
- connections (netstat -ano; nettop or lsof) include the test's own connection
- routes, interfaces and DNS servers, with a default route
- sensors: WMI battery and fans, GPU counters (Windows); ioreg (macOS)
- Keep Awake's system hold, started with Keeper's own command line (SetThreadExecutionState through Add-Type; caffeinate), shows in `powercfg /requests` or `pmset -g assertions` and is read back by Keeper's parsers
- energy impact from `top` and `pmset -g assertions` (macOS)
- the volume mixer's Core Audio code runs (Windows; CI machines have no sound device, so no streams)
- Stage's dry run: every value Stage would change, read the way Stage reads it before changing it (registry, taskbar and desktop icons through Add-Type on Windows; `defaults` on macOS), with the write commands built but not run; the screen sizes it could switch to (Windows)
- every setting in the settings catalogue that can be read without an administrator: `reg query`, `powercfg /q`, `sc qc` on Windows; `defaults`, `pmset`, `mdutil`, `spctl` on macOS

**The packaged app** ([test/e2e/native-smoke.cjs](../test/e2e/native-smoke.cjs)):

- starts and reaches the main window; `app.isPackaged`; its data folder is the one the `keeper` command looks in
- Settings keeps a change and writes it; the Settings page opens with the system integrations
- Keep Awake turns on with Electron's hold plus the system's (caffeinate / SetThreadExecutionState), shows in `pmset -g assertions` / `powercfg /requests` and in "What keeps this computer awake", and lets go of everything when turned off
- the monitor: live processor, memory, network and disk readings, the process list (including Keeper itself), sensors, energy impact (macOS), the volume mixer (Windows), dev servers
- Stage, without starting it: how each switch works here, the screen sizes (on macOS from the helper inside the packaged app), capture detection, the app list
- Remote Desktops builds the command for the system's own client without starting it: `mstsc.exe <file>.rdp /multimon` on Windows, `open <file>.rdp` and `open vnc://…` on macOS, `ssh` everywhere
- the `keeper` command, run by the app's own runtime the way the installers' shim runs it: `--version`, `awake on|status|off` against the running app, `stage support`, `display list`, and the standalone `ps`, `sensors`, `ports` and (Windows) `volume`
- no page errors, and nothing left running after Keeper quits (no stray caffeinate)

Screenshots are uploaded as the `native-shots-*` artifact.

Run it on your own Mac or PC only if you are happy for Keeper's data folder to
be emptied: the script refuses unless `CI=true`. On Linux it uses a throwaway home:

```sh
npm run build && npx electron-builder --dir --publish never
xvfb-run -a node test/e2e/native-smoke.cjs release/linux-unpacked/keeper /tmp/shots
```

## What needs a person (permissions or hardware)

CI machines cannot answer macOS privacy prompts (TCC; GitHub's Macs come with Accessibility, Screen Recording and Automation already allowed for the runner, which a person's Mac does not), have no sound
devices, cameras, batteries, fans, Bluetooth or external displays, and nobody
can answer a prompt. These are checked by hand before a release:

**macOS**

- Accessibility: notification mirroring (`notifications.watch`), voice editing and the focused-field check (`voice.focus` answers `secure: null` without it), remote control input (`input.*`), computer use
- Input Monitoring: the hold-to-talk key (`voice.keys`) and Stage's keystroke and click overlays (`stage.events`)
- Screen Recording: remote screen sharing, Stage capture detection by window title, system audio for the meeting recorder (`voice.systemAudio`)
- Automation (System Events): Stage's Dock and menu bar switches (GitHub's Macs happen to allow it, so the dry run reads them there; on a fresh Mac macOS asks first)
- Calendars and Reminders (EventKit), Speech Recognition (`speech.transcribe`)
- Apple Intelligence (`chat`) and on-device translation need a supported Mac with Apple Intelligence on; CI reports `deviceNotEligible`
- External displays over DDC/CI (`ddc.get`, `ddc.set`, input switching), display mode changes (`stage.setMode`), the call mute (`calls.mute`) with a real microphone
- Closed-lid Keep Awake (`pmset -a disablesleep`, needs an administrator once)
- The content filter (KeeperFilter network extension) needs a Developer ID, its entitlement and approval in System Settings; it is not built on CI
- Siri and Shortcuts actually running the Intents actions (the build and metadata are checked)

**Windows**

- Anything that needs an administrator prompt: unattended access (the Link service is compiled on CI but not installed), closed-lid Keep Awake (powercfg lid action), optional Windows features, firewall changes
- The notification listener needs the person to allow notification access (the Windows Runtime types are loaded on CI)
- Windows Hello for Keeper Lock, OCR languages that are not installed, media sessions with a real player
- The volume mixer and call mute with real sound devices; SendInput and BlockInput against a real desktop session; the WorkerW live wallpaper and the Stage overlays on a real desktop
- External displays over DDC/CI and real display mode changes (only listed on CI)

**Both**

- Bluetooth, Wi-Fi switching, VPN connections, battery and fan readings, GPUs
- Remote Desktop clients actually connecting (CI only builds their commands)
- Installers (dmg, nsis), signing, notarization and updates
