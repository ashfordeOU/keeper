# Quick Controls

Quick Controls switches network, firewall, privacy and security settings from one place: the **Quick Controls** page (System section of the sidebar), a few tiles in the Island's **Controls** tab, a **Quick Controls** submenu in the tray / menu bar, and command-palette entries ("Quick Controls", "Public Wi-Fi preset", "Lockdown preset", "Turn Wi-Fi on or off").

Not every setting can be switched by an app. Each control says how it works on the computer in front of you:

| Badge | Meaning |
|---|---|
| **Direct** | Keeper switches it, no password. |
| **Needs password** | Keeper switches it after the system's own administrator prompt (pkexec on Linux, the macOS password dialog, UAC on Windows). |
| **Opens Settings** | The system does not let apps change it, or the tool Keeper needs is not installed. Keeper opens the exact Settings page through the guide layer instead (`core/guide/links.ts`). |
| **Not on this system** | The system has no such setting. |

The badge shown is worked out on the machine. If a control is normally Direct but its tool is missing (for example `nmcli`, `bluetoothctl`, `pactl` or `pkexec` on Linux), it drops to **Opens Settings** and says why.

## How it behaves

- **Read on demand.** Settings are read when the page, the tray menu or the Island tiles open, and again after every change. Each read runs at the same time as the others, with a 10-second limit per control. Results are cached for 5 seconds. Nothing polls in the background. The tray reads once, 10 seconds after start, and then follows changes.
- **One password per batch.** When a change or preset needs administrator rights, Keeper gathers every administrator step into one script and asks once. On Linux that is one `pkexec sh -c`, on macOS one `do shell script … with administrator privileges`, and on Windows one elevated PowerShell. Each part runs even if an earlier one fails. The settings are then read again, so the result reports exactly what changed and what did not.
- **Never weakened silently.** Every control that can lower protection has a "weaker" value (marked ⚠︎ below), for example firewall off, Defender off, encrypted DNS off, or camera on for apps. Moving to it needs an explicit confirmation, and the dialog says why it matters. The API refuses the change without `confirmWeaker`. The tray and the Island never confirm: they send you to the page instead.
- **Logged with undo.** Every change, preset and undo is one entry in the change list (`quick-controls.json` in Keeper's data folder, last 100 entries). **Undo** puts back the earlier values Keeper actually read; values it could not read are not guessed. Undoing something that made the computer safer is itself a weakening change, so it is confirmed too.
- **Presets.** Four presets ship:
  - **Public Wi-Fi**
  - **Home**
  - **Presenting / private**
  - **Lockdown**

  "Review and apply…" shows the exact plan first: what changes, from what to what, which changes need the password, which changes you must make in Settings, and what this system lacks.
- **Presets per firewall profile.** A preset can be bound to each firewall profile (for example *Public Wi-Fi* → the Public Wi-Fi profile). When the firewall switches profile, either by hand or automatically by network, Keeper applies only the preset's **direct, strengthening** changes. Anything that needs a password or would lower protection waits, and the Island says so.
- **Per-app access.** Under Privacy, "Each app's camera, microphone and location access" lists apps from Privacy & Security (`security.permissions()`).
  - **Windows:** Keeper denies or allows a desktop app directly. It writes `ConsentStore\<capability>\NonPackaged\<path with # for \>` `Value=Allow|Deny` under HKCU.
  - **macOS and Flatpak:** taking access away uses the existing revoke (`tccutil reset`, `flatpak permission-set`).
  - **Everywhere:** granting access opens the Settings page, because only the system or the app's own prompt may grant it.
- **Features.** The whole page is the `quickControls` feature (Settings → Features). Each group can also be switched off on its own:
  - `quickControlsNetwork`
  - `quickControlsFirewall`
  - `quickControlsPrivacy`
  - `quickControlsSecurity`

  A group that is off is not read and does not appear on the page, in the tray or in the Island.

## What each system allows

Generated from `core/controls/catalog.ts`. "Direct" and "With admin" assume the usual tools are present. Keeper checks this on the machine, as described above. *(Keeper)* marks Keeper's own settings. ⚠︎ marks controls with a less-protective value that must be confirmed.

### Network

| Control | macOS | Windows | Linux | Notes |
|---|---|---|---|---|
| Wi-Fi | Direct | Direct | Direct | **Windows:** Through the Windows radio switch (the same one as in Quick Settings). |
| Bluetooth | Guide only | Direct | Direct | **macOS:** macOS has no public way for apps to switch Bluetooth; Keeper opens Bluetooth settings. |
| Airplane mode | — | Guide only | Direct | **macOS:** Macs have no airplane mode; switch Wi-Fi and Bluetooth off instead. **Windows:** Windows does not let apps switch airplane mode; Keeper opens it. **Linux:** Through NetworkManager (all radios). |
| VPN *(Keeper)* | Direct | Direct | Direct | **macOS:** VPNs set up in System Settings or by their apps. **Windows:** Windows VPN connections and WireGuard tunnels. **Linux:** NetworkManager VPNs. |
| Encrypted DNS for the system ⚠︎ | Guide only | With admin | With admin | **macOS:** macOS needs a DNS settings profile for system-wide encrypted DNS; Keeper’s DNS filter (Firewall) encrypts it instead. **Windows:** Windows 11 encrypted DNS (DoH) on the main adapter. **Linux:** systemd-resolved DNS over TLS on the active connection. |
| Proxy settings | Guide only | Guide only | Guide only |  |
| IPv6 ⚠︎ | With admin | With admin | With admin |  |
| Hotspot ⚠︎ | Guide only | Guide only | Direct | **macOS:** Internet Sharing is only in System Settings. **Windows:** Mobile hotspot is only in Settings for apps like Keeper. **Linux:** NetworkManager hotspot on the Wi-Fi device. |
| Treat this network as public ⚠︎ | Guide only | With admin | Guide only | **macOS:** Turn off the sharing services in Sharing settings. **Windows:** The network profile (Public or Private). **Linux:** Firewall zones depend on the distribution; use Firewall below. |
| AirDrop ⚠︎ | Direct | — | — | **macOS:** Takes effect after Finder restarts or at next login. |
| Wake for network access | With admin | Guide only | With admin | **Windows:** Set on the adapter in Device Manager. **Linux:** On the wired adapter (ethtool). |

### Firewall

| Control | macOS | Windows | Linux | Notes |
|---|---|---|---|---|
| System firewall ⚠︎ | With admin | With admin | With admin | **Linux:** ufw or firewalld, whichever is installed. |
| Stealth mode ⚠︎ | With admin | — | — | **Windows:** Windows already drops unsolicited traffic when the firewall is on. **Linux:** Most firewalls already drop rather than reject. |
| Block all incoming connections ⚠︎ | With admin | With admin | — | **Linux:** ufw and firewalld already refuse incoming connections you have not allowed; switch the system firewall on above. |
| Keeper firewall *(Keeper)* ⚠︎ | Direct | Direct | Direct |  |
| Keeper firewall rules in force *(Keeper)* ⚠︎ | With admin | With admin | With admin |  |
| DNS filter *(Keeper)* ⚠︎ | Direct | Direct | Direct |  |
| Blocklists *(Keeper)* ⚠︎ | Direct | Direct | Direct |  |

### Privacy

| Control | macOS | Windows | Linux | Notes |
|---|---|---|---|---|
| Camera for apps ⚠︎ | Guide only | Direct | With admin | **macOS:** macOS only lets you change this per app in Privacy & Security; Keeper can make an app ask again. **Windows:** The “Let apps access your camera” switch for your account. **Linux:** Unloads the camera driver (uvcvideo) until switched back on. |
| Microphone for apps ⚠︎ | Guide only | Direct | Direct | **macOS:** Per app only, in Privacy & Security. **Windows:** The “Let apps access your microphone” switch for your account. **Linux:** Mutes the default input (an app can still unmute it). |
| Location for apps ⚠︎ | Guide only | Direct | — | **Windows:** The “Let apps access your location” switch for your account. **Linux:** Desktop location services are off unless an app uses GeoClue; see the app’s own settings. |
| Advertising ID ⚠︎ | Guide only | Direct | — |  |
| Send diagnostics to the system maker ⚠︎ | With admin | With admin | With admin | **macOS:** Share Mac Analytics. **Windows:** Optional diagnostic data (the required level stays on Windows Home and Pro). **Linux:** Crash reporting (apport/whoopsie) where installed. |
| System clipboard history ⚠︎ | — | Direct | — | **macOS:** Keeper’s own clipboard history is in the Island. |
| Clipboard sync across devices ⚠︎ | Guide only | Direct | — | **macOS:** Universal Clipboard follows Handoff in General settings. |
| Activity history ⚠︎ | — | With admin | Guide only | **Linux:** GNOME: Privacy → File History. |
| Ask for the password after sleep or screen saver ⚠︎ | Guide only | Guide only | Direct | **Linux:** GNOME screen lock (gsettings). |
| Bluetooth discoverable ⚠︎ | Guide only | Guide only | Direct |  |
| Find My | Guide only | Guide only | — |  |
| Assistant and AI data settings | Guide only | Guide only | — |  |

### Security

| Control | macOS | Windows | Linux | Notes |
|---|---|---|---|---|
| Keeper real-time protection *(Keeper)* ⚠︎ | Direct | Direct | Direct |  |
| Quarantine what is found *(Keeper)* ⚠︎ | Direct | Direct | Direct |  |
| Gatekeeper ⚠︎ | With admin | — | — | **macOS:** Turning it off also needs a confirmation in System Settings on recent macOS. |
| Microsoft Defender real-time protection ⚠︎ | — | With admin | — |  |
| SmartScreen ⚠︎ | — | Guide only | — |  |
| Automatic system updates ⚠︎ | With admin | Guide only | With admin | **Windows:** Windows manages updates itself; pause them in Settings. **Linux:** unattended-upgrades where installed. |

### How each system's setting is changed

| Control | macOS | Windows | Linux |
|---|---|---|---|
| Wi-Fi | `networksetup -setairportpower <dev> on/off` | `Windows.Devices.Radios` (`Radio.SetStateAsync`) from PowerShell | `nmcli radio wifi on/off` |
| Bluetooth | — | `Windows.Devices.Radios` | `bluetoothctl power on/off` |
| Airplane mode | — | — | `nmcli radio all off` + `bluetoothctl power off` (read: `rfkill -J`) |
| Encrypted DNS | — | `Add-DnsClientDohServerAddress … -AutoUpgrade $true` + `Set-DnsClientServerAddress` (elevated) | `nmcli connection modify <conn> ipv4.dns 'ip#host …' connection.dns-over-tls 2` (pkexec) |
| IPv6 | `networksetup -setv6off / -setv6automatic` (admin) | `Disable/Enable-NetAdapterBinding -ComponentID ms_tcpip6` (elevated) | `nmcli connection modify <conn> ipv6.method disabled/auto` (pkexec) |
| Network treated as public | — | `Set-NetConnectionProfile -NetworkCategory Public/Private` (elevated) | — |
| Hotspot | — | — | `nmcli device wifi hotspot` / `nmcli connection down Hotspot` |
| AirDrop | `defaults write com.apple.NetworkBrowser DisableAirDrop -bool YES/NO` | — | — |
| Wake on LAN | `pmset -a womp 1/0` (admin) | — | `ethtool -s <iface> wol g/d` (pkexec) |
| System firewall | `socketfilterfw --setglobalstate on/off` (admin) | `Set-NetFirewallProfile -All -Enabled True/False` (elevated) | `ufw --force enable` / `ufw disable`, or `systemctl enable/disable --now firewalld` (pkexec) |
| Stealth mode | `socketfilterfw --setstealthmode on/off` (admin) | — | — |
| Block all incoming | `socketfilterfw --setblockall on/off` (admin) | `Set-NetFirewallProfile -All -DefaultInboundAction Block -AllowInboundRules False` (elevated) | — |
| Camera for apps | — | HKCU `…\ConsentStore\webcam` `Value=Allow/Deny` | `modprobe -r uvcvideo` / `modprobe uvcvideo` (pkexec) |
| Microphone for apps | — | HKCU `…\ConsentStore\microphone` | `pactl set-source-mute @DEFAULT_SOURCE@ 1/0` |
| Location for apps | — | HKCU `…\ConsentStore\location` | — |
| Advertising ID | — | HKCU `…\AdvertisingInfo` `Enabled` | — |
| Diagnostics | `defaults write …/DiagnosticMessagesHistory.plist AutoSubmit` (admin) | HKLM policy `DataCollection\AllowTelemetry` 1/3 (elevated) | `systemctl disable --now apport whoopsie` (pkexec) |
| Clipboard history / sync | — | HKCU `Software\Microsoft\Clipboard` `EnableClipboardHistory` / `EnableCloudClipboard` | — |
| Activity history | — | HKLM policy `System\PublishUserActivities`, `UploadUserActivities` (elevated) | — |
| Lock after sleep | — | — | `gsettings set org.gnome.desktop.screensaver lock-enabled` (GNOME) |
| Bluetooth discoverable | — | — | `bluetoothctl discoverable on/off` |
| Gatekeeper | `spctl --global-enable / --global-disable` (admin) | — | — |
| Defender real-time | — | `Set-MpPreference -DisableRealtimeMonitoring` (elevated) | — |
| Automatic updates | `defaults write /Library/Preferences/com.apple.SoftwareUpdate AutomaticCheckEnabled …` (admin) | — | `systemctl enable/disable --now unattended-upgrades` (pkexec) |

Every name that comes from the system, such as connection names, adapter aliases and executable paths, is quoted for the shell (`sh`) or PowerShell (`ps`) before use. The tests check this with hostile names.

Some changes have limits that the system itself imposes:
- On recent macOS, turning Gatekeeper off also has to be confirmed in System Settings.
- Tamper Protection can block Defender changes.
- AirDrop changes take effect after Finder restarts.
- Windows Home and Pro keep the required diagnostic level.

## Keeper's own settings

These controls call into Keeper's own services; no system command runs:

| Control | Service call |
|---|---|
| VPN | `net.vpnAction` on the first or connected VPN |
| Keeper firewall mode | `fwApi.setMode` |
| Rules in force | `fwApi.setSettings({ enforce })` |
| DNS filter | `fwApi.setSettings({ dnsFilter })` |
| Blocklists | the lists that were on are remembered and restored |
| Real-time protection | `security.setSettings` |
| Quarantine what is found | `security.setSettings` |

## Code

| Part | Files |
|---|---|
| Pure logic (tested) | `core/controls/types.ts`, `catalog.ts` (controls, support per system, presets), `cmds.ts` (readers, parsers, builders, batching, quoting), `plan.ts` (weakening checks, preset plans, undo) |
| Service | `electron/services/controls.ts`, IPC in `electron/ipc/controls.ts`, API types in `core/api-controls.ts` |
| Interface | `src/screens/Controls.tsx`, `src/island/QuickTiles.tsx`, tray submenu in `electron/main.ts`, browser demo in `src/mock-controls.ts` |
| Tests | `test/controls.test.ts` (parsers with recorded output, builders per system, quoting, one-prompt batching, presets, warnings, undo), `test/e2e/controls.cjs` (the real app on Linux) |

`KEEPER_CONTROLS_DRYRUN=<file>` is a test mode. System changes are written to that file instead of run, and the real readers still run. Of Keeper's own settings, only the firewall mode changes for real.

## What has been verified

- **Linux, in the real app under xvfb** (`test/e2e/controls.cjs`), with stand-ins for `nmcli` and `bluetoothctl`:
  - real reading;
  - a direct toggle (test mode);
  - Keeper's firewall mode switched for real;
  - the weakening dialog, with cancel and with confirm;
  - undo;
  - a preset, applied and then reverted;
  - a preset bound to a firewall profile;
  - a group switched off in Features;
  - light and dark screenshots.
- **macOS and Windows:** the commands and parsers are unit-tested against recorded output, but they have **not** been run on real Macs or Windows PCs from this repository's CI. Treat these as needing a check on real hardware before relying on them:
  - Windows radio switching through `Windows.Devices.Radios` from PowerShell;
  - the encrypted-DNS cmdlets on Windows 10, which does not have them;
  - the macOS `socketfilterfw` output wording across versions.
- **Real administrator prompts** (pkexec, the macOS password dialog, UAC) are not exercised by the E2E. It uses test mode.

## Sources

- macOS application firewall flags (`--setglobalstate`, `--setstealthmode`, `--setblockall`, `--get*`): krypted.com/?p=7275, krypted.com/?p=44759, gist.github.com/noize-e/a3b13553e89f240b769aa4a89f15b127, discussions.apple.com/thread/254609854
- macOS firewall and AirDrop baselines: STIG Viewer, macOS 26 (Tahoe) V-277092; Tenable CIS audit item "Ensure AirDrop is disabled" (`com.apple.NetworkBrowser DisableAirDrop`)
- Windows ConsentStore (camera/microphone/location, `Value` Allow/Deny, `NonPackaged` for desktop apps): elevenforum.com tutorials on microphone and camera access; geekrewind.com
- Windows encrypted DNS (`Add-DnsClientDohServerAddress`, `-AutoUpgrade`, DNS over TLS): elevenforum.com DNS over HTTPS / TLS tutorials; Microsoft Learn, DnsClient module
- NetworkManager DNS over TLS (`connection.dns-over-tls`, `ip#servername` in `ipv4.dns`): developer.cloud.tencent.cn/article/2020728; `nmcli` and `nm-settings` manuals
- Windows radios: Microsoft Learn, `Windows.Devices.Radios.Radio` (`RequestAccessAsync`, `GetRadiosAsync`, `SetStateAsync`)
