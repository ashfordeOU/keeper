<!-- SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0 -->
# Permissions

Keeper asks for system permissions only for the features that need them, and
works without any of them. This page lists every permission Keeper's features
can use on macOS, Windows and Linux, what uses it, and how to take it back.

## Setting them up

- **First run.** The welcome tour has a **Permissions** step. Choose **Set up
  everything now** (recommended) to see the whole list and allow it in one go,
  or **Only what I turn on** to let each feature ask the first time you use it.
  Skipping is always possible; nothing in Keeper waits for it.
- **Any time.** Settings → Permissions, or the command palette (⌘K / Ctrl+K →
  “Permissions”), or `keeper://settings/permissions`.
- **Allow all** walks through every missing permission one after another: it
  shows which one is next and what to click in the system's question or
  settings page, and moves on by itself as soon as the system reports it
  allowed. Each step can be skipped.
- **Live status.** While the screen is open Keeper checks once a second, and
  again whenever its window comes back into focus. Nothing is checked while the
  screen is closed.
- **States:** *Allowed*, *Not yet*, *Turned off* (you said no before; only the
  settings page can change it), *Not needed* (every feature that uses it is
  off), *Can’t be checked* (the system gives apps no way to read it, such as
  macOS's Local Network switch) and *Restart to finish*.
- **Restarts.** On macOS, Screen & System Audio Recording and Input Monitoring
  take effect only after Keeper restarts. **Restart Keeper now** reopens your
  windows and tabs and comes back to the Permissions step.
- **When a feature needs one later,** it does not interrupt you with a system
  prompt if you set everything up: Keeper shows “Keeper needs … for this” with
  **Open Permissions**, which highlights that row. If you chose *Only what I
  turn on* (or skipped the step), the system's own question still appears as
  before.

## Installers

- **macOS (DMG, zip, Homebrew):** a disk image has no installer step, so the
  first launch is the moment: the tour's Permissions step.
- **Windows (setup.exe):** the last page of the installer has an optional box,
  **Open Keeper and set up permissions**, which opens Keeper at Settings →
  Permissions.
- **Linux (.deb, .rpm):** the package prints a short note after installing
  about the optional permissions and where to find them. AppImage and tar.gz
  users see the tour step on first launch.

## Not used

Keeper does not ask for **Contacts** (Mail and Calendar read contacts from your
accounts over CardDAV, not from the system's address book), **Bluetooth** (the
battery levels of connected devices come from System Information) or
**Photos** (the library reads the folders you choose).

## macOS

| Permission | Why | Used by | What Allow does | How to take it back |
|---|---|---|---|---|
| **Accessibility** | Lets Keeper type dictated text, show other apps’ notifications in the Island, tidy windows for Stage, and be controlled from your other devices. | Dictation, Notifications in the Island, Stage mode, Remote screens, Let others reach this computer, Unattended access, AI agents, Keep awake, Writing help | Shows the system’s own question. macOS asks: choose “Open System Settings”, then switch on Keeper under Accessibility. | System Settings → Privacy & Security → Accessibility: switch Keeper off (or select it and press −). |
| **Screen & System Audio Recording** (restart) | Lets Keeper take screenshots and recordings, copy text from the screen, record a meeting’s sound and share this screen with your devices. | Screenshots and recording, Meeting recorder, Stage mode, Remote screens, Let others reach this computer, AI agents | Shows the system’s own question. macOS asks: choose “Open System Settings”, switch on Keeper, then choose “Later” and use Restart Keeper here. | System Settings → Privacy & Security → Screen & System Audio Recording: switch Keeper off (or select it and press −). |
| **Input Monitoring** (restart) | Lets Keeper notice the hold-to-talk key for dictation, show your keystrokes on Stage and see when you press mute in a call. | Hold a key to talk, Display keys, Calls in the Island, Stage mode | Shows the system’s own question. macOS asks: choose “Open System Settings”, switch on Keeper under Input Monitoring, then restart Keeper here. | System Settings → Privacy & Security → Input Monitoring: switch Keeper off (or select it and press −). |
| **Microphone** | Used only while you dictate, record a meeting or a voice note, or check your microphone in the Island. | Dictation, Meeting recorder, Notes, Teleprompter, Remote screens, Microphone and camera in use | Shows the system’s own question. macOS asks: choose “Allow”. | System Settings → Privacy & Security → Microphone: switch Keeper off (or select it and press −). |
| **Camera** | Used only by the Island’s mirror, to check how you look before a call. | Island | Shows the system’s own question. macOS asks: choose “Allow”. | System Settings → Privacy & Security → Camera: switch Keeper off (or select it and press −). |
| **Full Disk Access** | Lets Keeper see where downloads came from in Mail and Safari, read which apps hold other permissions, and include protected folders in the library. | Where downloads came from, Privacy & Security, Malware protection, Notifications in the Island, Places & Tracks | Opens the exact settings page. System Settings opens at Full Disk Access: switch on Keeper (if it is not listed, press + and choose Keeper in Applications). | System Settings → Privacy & Security → Full Disk Access: switch Keeper off (or select it and press −). |
| **Automation: System Events** | Lets Keeper hide and show apps for Stage, read the front window for Cues and run quick controls. | Stage mode, Cues, Quick Controls, AI agents, App controls | Shows the system’s own question. macOS asks whether Keeper may control “System Events”: choose “Allow”. | System Settings → Privacy & Security → Automation → Keeper → System Events: switch Keeper off (or select it and press −). |
| **Automation: Finder** | Lets Keeper hide desktop icons for Stage, set folder icons, and eject or open places in Finder. | Stage mode, Custom folder icons, Disks, cloud drives and servers, Live wallpaper | Shows the system’s own question. macOS asks whether Keeper may control “Finder”: choose “Allow”. | System Settings → Privacy & Security → Automation → Keeper → Finder: switch Keeper off (or select it and press −). |
| **Automation: Music** | Lets the Island show and control what is playing in Music. | Now playing | Shows the system’s own question. Music opens in the background and macOS asks whether Keeper may control it: choose “Allow”. | System Settings → Privacy & Security → Automation → Keeper → Music: switch Keeper off (or select it and press −). |
| **Automation: Notes** | Lets Notes Everywhere read and write your Apple Notes. | Notes Everywhere: sync in the background | Shows the system’s own question. Notes opens in the background and macOS asks whether Keeper may control it: choose “Allow”. | System Settings → Privacy & Security → Automation → Keeper → Notes: switch Keeper off (or select it and press −). |
| **Notifications** | Lets alarms, timers, calendar alerts and health alerts reach you when Keeper is in the background. | Alarms, timers and world clocks, Calendar and reminders, Health and alerts, Cues, Focus timer and breaks | Shows the system’s own question. macOS asks: choose “Allow”. | System Settings → Notifications → Keeper: switch off “Allow notifications”. |
| **Calendars** | Lets the Island show your next meeting and its link from the calendars on this Mac. | Next meeting | Shows the system’s own question. macOS asks: choose “Allow Full Access”. | System Settings → Privacy & Security → Calendars: switch Keeper off (or select it and press −). |
| **Reminders** | Lets the Island list and check off your reminders. | Next meeting, To-dos in the Island | Shows the system’s own question. macOS asks: choose “Allow Full Access”. | System Settings → Privacy & Security → Reminders: switch Keeper off (or select it and press −). |
| **Location** | Lets the Toolbox fill in where you are; Weather and Places & Tracks work from places you add without it. | Toolbox | Shows the system’s own question. macOS asks: choose “Allow”. If nothing appears, switch on Location Services and Keeper in System Settings. | System Settings → Privacy & Security → Location Services: switch Keeper off (or select it and press −). |
| **Local Network** | Lets Keeper find and reach your other devices, servers and shared folders on this network. | Keeper on your other devices, Network browsing, Keeper Mesh, Cloud and servers, Remote Desktops | Runs a check (the system may ask). Keeper looks for devices on the network; if macOS asks, choose “Allow”. | System Settings → Privacy & Security → Local Network: switch Keeper off (or select it and press −). |
| **Open at login** | Starts Keeper quietly in the menu bar when you log in. | Start at login | Turns it on. Keeper adds itself; macOS may show a note that a login item was added. | System Settings → General → Login Items & Extensions: remove Keeper, or switch off Start at login in Keeper’s Settings → Features. |

## Windows

| Permission | Why | Used by | What Allow does | How to take it back |
|---|---|---|---|---|
| **Microphone** | Used only while you dictate, record a meeting or a voice note, or check your microphone. | Dictation, Meeting recorder, Notes, Teleprompter, Remote screens | Opens the exact settings page. Settings opens at Privacy & security → Microphone: switch on “Microphone access” and “Let desktop apps access your microphone”. | Settings → Privacy & security → Microphone: switch off “Let desktop apps access your microphone”. |
| **Camera** | Used only by the Island’s mirror, to check how you look before a call. | Island | Opens the exact settings page. Settings opens at Privacy & security → Camera: switch on “Camera access” and “Let desktop apps access your camera”. | Settings → Privacy & security → Camera: switch off “Let desktop apps access your camera”. |
| **Location** | Lets the Toolbox fill in where you are. | Toolbox | Opens the exact settings page. Settings opens at Privacy & security → Location: switch on “Location services” and “Let desktop apps access your location”. | Settings → Privacy & security → Location: switch off “Let desktop apps access your location”. |
| **Notifications** | Lets alarms, timers, calendar alerts and health alerts reach you. | Alarms, timers and world clocks, Calendar and reminders, Health and alerts, Cues, Focus timer and breaks | Opens the exact settings page. Settings opens at System → Notifications: switch on Notifications, and Keeper in the list. | Settings → System → Notifications: switch off Keeper. |
| **Administrator approval** | A few changes need it each time: firewall rules, Keeper Mesh’s network adapter and startup items for every user. Windows asks then; Keeper never runs as administrator all the time. | Firewall, Keeper Mesh, Startup items and apps | Explains; the system asks when needed. When Windows asks “Do you want to allow this app to make changes?”, check that it names Keeper by Ashforde and choose Yes. | Nothing is kept: each approval is for one change. |
| **Firewall** | The first time Keeper answers your other devices, Windows Defender Firewall asks whether it may use the network. | Keeper on your other devices, Keeper Mesh, Cloud and servers, Direct connections between your devices | Explains; the system asks when needed. When Windows Security asks, tick “Private networks” (home and work) and choose “Allow”. Public networks are best left off. | Windows Security → Firewall & network protection → Allow an app through firewall: untick Keeper. |

## Linux

| Permission | Why | Used by | What Allow does | How to take it back |
|---|---|---|---|---|
| **Screen sharing (portal)** | Lets Keeper take screenshots and recordings and share this screen on Wayland; the desktop asks each time unless you let it remember. | Screenshots and recording, Meeting recorder, Remote screens, Stage mode | Runs a check (the system may ask). Press Test: your desktop asks which screen to share; pick one and choose Share (tick “Remember” if it offers). | Your desktop’s Settings → Privacy (or Apps → Keeper): remove the screen sharing permission. Nothing is kept unless you chose to remember. |
| **Remote control (portal)** | Lets your other devices move the pointer and type on this computer on Wayland. | Remote screens, Let others reach this computer, Control on Wayland, Unattended access | Runs a check (the system may ask). Press Test: your desktop asks to allow remote interaction; choose Allow. | Your desktop’s Settings → Privacy → Remote desktop, or end the session. |
| **Location (portal)** | Lets the Toolbox fill in where you are. | Toolbox | Runs a check (the system may ask). Press Test: if your desktop asks, choose Allow. Location services must be on in Settings → Privacy. | Settings → Privacy → Location services: switch off Keeper or location services. |
| **Camera (portal)** | Used only by the Island’s mirror. | Island | Runs a check (the system may ask). Press Test: if your desktop asks, choose Allow. | Settings → Privacy → Camera: switch off Keeper. |
| **Keyboard access (input group)** (restart) | Lets Keeper notice the hold-to-talk key and show keystrokes on Stage under Wayland, by reading /dev/input. | Hold a key to talk, Display keys, Stage mode | Explains; the system asks when needed. In a terminal run: sudo usermod -aG input $USER — then log out and in again. Only do this if you use these features: any app you run can then read the keyboard. | sudo gpasswd -d $USER input, then log out and in again. |
| **Accessibility bus (AT-SPI)** | Lets Keeper read other apps’ notifications and controls for the Island and AI agents. | Notifications in the Island, AI agents, Dictation | Runs a check (the system may ask). On GNOME, switch on Settings → Accessibility → any assistive feature, or run: gsettings set org.gnome.desktop.interface toolkit-accessibility true | gsettings set org.gnome.desktop.interface toolkit-accessibility false |


## For developers

- The catalogue is `core/permissions.ts` (one entry per permission and
  system); `test/permissions.test.ts` checks every entry names real features.
- The live checks are `electron/services/permissions.ts`. On macOS a fresh
  `keeper-helper` answers `permissions.status` and `permissions.request`
  (`native/macos/KeeperHelper/Sources/keeper-helper/Permissions.swift`): a new
  process sees a permission granted since Keeper started, which is how “Restart
  to finish” is told apart.
- A feature that needs a permission mid-task calls `permissionNeeded(id,
  feature)` from `electron/services/permission-nudge.ts`. It returns whether to
  still show the system's own question (only when the person did not choose to
  set everything up).
- The Mac test kit has a guided check: `scripts/mac-test/run.sh --only permscreen`
  opens the screen, asks you to press Allow all, and records which became
  allowed.
