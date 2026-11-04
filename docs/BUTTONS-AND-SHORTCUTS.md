# Buttons & Shortcuts (experimental)

Gives the extra buttons of a mouse a job, and changes what a shortcut does in
one app. It listens to the mouse, so it is **off** until you turn it on, and it
is marked *Experimental* on its page.

- Page: **Buttons & Shortcuts** in the sidebar's Desktop section (shown once the part is on).
- Feature (Settings → Features → Desktop, under Advanced): `mouseButtons`, **off** by default. While it is off, or on with nothing to do, nothing listens: no mouse hook without a button job, and no look at the app in front without an app shortcut.
- Settings → General → Mouse buttons and app shortcuts: a link to the page; under More settings (macOS and Windows) *Stop a button's own action*, off by default.

## The page

- **On this computer**: one line for mouse buttons and one for app shortcuts, green when they work here and amber with the one step to take when they do not (see below).
- **Mouse buttons**: each row is a button (Back side button, Forward side button, Middle button), an app (empty means every app; the field suggests the apps open now) and its job: Go back, Go forward, Copy, Paste, Undo, Close the tab, New tab, Show all windows (Task view on Windows, Overview on Linux), or *Other keys…* to press any combination. A button's job in the app in front wins over its every-app job. The card's line says how Keeper hears the mouse and the last button it heard.
- **App shortcuts**: an app, *When I press* and *send*. Keeper registers the first shortcut only while that app is in front, and sends the second one instead; the keys still held from the first are let go first, so the app gets exactly what you chose. With another app in front the keys are free again, for that app and for the system.

Ready-made jobs use each system's own keys (Go back is ⌘[ on a Mac and Alt+Left elsewhere).

## Works with your computer

| System | Hearing the mouse | Sending keys | Stopping the button's own action |
|---|---|---|---|
| macOS | an event tap in Keeper's helper (`voice.mouse`), listen-only; asks for Input Monitoring once | Keeper's helper (the same as remote control), needs Accessibility | yes: a default event tap that swallows the buttons with a job (needs Accessibility) |
| Windows | a low-level mouse hook (`WH_MOUSE_LL`) in a small PowerShell-hosted program; clicks Keeper sends itself are ignored | `SendInput` through the same host as remote control | yes: the hook swallows the buttons with a job |
| Linux, X11 | the mouse's `/dev/input` device when readable (the "input" group), else `xinput test-xi2` raw button events | `xdotool` | no: Linux lets Keeper listen to a button, not take it over, so the button also does what it always did (the page says so) |
| Linux, Wayland | the mouse's device if you are in the "input" group | not possible: Wayland does not let apps send keys to other apps (the page says so) | no |

Not built: a scroll direction for the mouse apart from the trackpad on a Mac.
macOS has one setting for both, and separating them means rewriting every
scroll event, which risks lag; the Mac page says so in one line.

## Cautions

- Input remapping can add a little delay and can surprise you when a button stops doing what it did. Keep *Stop a button's own action* off unless you need it.
- A shortcut changed in one app is taken from that app only while it is in front; if another app (or the system) already holds those keys, Settings → Shortcuts says "taken by…".

## What was checked, and how

- `core/input-remap.ts` (button codes on each system, mice in `/proc/bus/input/devices`, xinput raw events, matching the app in front, which job wins, accelerators to key events with held modifiers let go, ready-made jobs per system, settings, what each system allows) has unit tests in `test/input-remap.test.ts`.
- `test/e2e/desk.cjs` drives the real app on an X11 desktop: the part off and on, the honest lines, a button added on the page, an app shortcut for a real `xterm` that is taken only while the xterm is in front and given back afterwards, and the keys from that shortcut and from the back button's job (pressed through a test hook that never works in official builds) typed into the xterm.
- Not run in automated tests: hearing real mouse buttons (Xvfb has none; xinput was not installed), the Mac event tap (new code in Keeper's helper, built on macOS in CI but not exercised), the Windows hook and stopping a button's own action on macOS and Windows. These need a real Mac, a real Windows PC and a mouse with side buttons.
