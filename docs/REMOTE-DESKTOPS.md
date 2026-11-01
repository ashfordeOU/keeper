# Remote Desktops

Keeper by Ashforde® connects to your other computers by any protocol, and can make this computer reachable. Open **Remote Desktops** in the sidebar, or reach it from anywhere (see *Where it appears*).

## Connecting

- **Saved connections** with folders (`Work/Lab`), tags, colours, favourites, notes and search. Pick several and press *Open in Tabs*: each opens in its own Keeper tab.
- **Quick connect** accepts `rdp://host`, `vnc://host:5901` (`:1` means display 1 = port 5901, `::5999` is a port), `ssh user@host -p 2222 -J bastion`, `user@host`, `https://idrac.lan/`, `serial:///dev/ttyUSB0?baud=115200`, or a bare name or address. For a bare host Keeper knocks on ports 3389, 5900–5910, 22 and 5985 (0.6 s each, at most 8 at once) and picks RDP, then VNC, then SSH, then PowerShell.
- **Status dots** come from one TCP knock per connection every 30 seconds through Keeper's scheduler, only while the page is open (slower when you are away, paused while the screen is locked). Closing the page stops it.
- **Wake-on-LAN**: give a connection its network card address and press the power button; the magic packet goes to every local broadcast address (ports 9 and 7). Paired Keeper devices use the Remote Screens wake-up.
- **Keeper devices** you paired appear in the same page; *Connect* opens Keeper's own remote screen viewer.

### Protocols

| Protocol | Windows | macOS | Linux |
|---|---|---|---|
| VNC | In a Keeper tab | In a Keeper tab | In a Keeper tab |
| VNC, outside viewer (optional) | TigerVNC `vncviewer` | TigerVNC, else Screen Sharing (`open vnc://…`) | TigerVNC `vncviewer` |
| Remote Desktop (RDP) | `mstsc` with a temporary .rdp file | FreeRDP if installed, else the system's .rdp app through `open` | FreeRDP (`xfreerdp3`, `sdl-freerdp3`, `xfreerdp`…) |
| SSH | Terminal tab (`ssh.exe`) | Terminal tab | Terminal tab |
| Mosh | Not available (use WSL) | Terminal tab | Terminal tab |
| Telnet | Terminal tab (`telnet` or `plink`) | Terminal tab | Terminal tab |
| Serial console | Terminal tab (`plink -serial`) | Terminal tab (`picocom`, `minicom`, `screen`, `cu`) | Terminal tab (same) |
| SPICE | `remote-viewer` with a .vv file | `remote-viewer` | `remote-viewer` |
| X2Go / NX | `x2goclient` with a session file | `x2goclient` | `x2goclient` |
| PowerShell remoting | Terminal tab (`Enter-PSSession`) | Terminal tab (`pwsh`, needs WinRM support installed) | Terminal tab (`pwsh`) |
| Web consoles | In a Keeper tab | In a Keeper tab | In a Keeper tab |
| Keeper devices | Keeper's remote screen viewer | same | same |

**VNC in Keeper** is Keeper's own small RFB client (`core/rdc/rfb.ts`): protocol 3.3/3.7/3.8; sign-in with no password, the VNC password, or VeNCrypt with TLS (X509/TLS subtypes, with VNC or Plain inside); pictures in Raw, CopyRect, RRE, Hextile and ZRLE; the pointer shape, desktop resizes and the clipboard both ways. Tight and Apple's own sign-in are not built; such servers can be opened in an outside viewer. The TCP connection lives in the main process; each update is decoded there to RGBA and sent to the tab, and the next update is asked for only after the tab has drawn the last, so a hidden tab costs nothing. The toolbar has *Fit*/*100 %*, *View only*, special keys (Ctrl+Alt+Del, Ctrl+Alt+End, the Windows key, Alt+Tab, Print Screen, Ctrl+Alt+F1/F2), *Send clipboard* and *move to its own window*.

**RDP inside Keeper is not built.** A JavaScript or WebAssembly RDP client would need TLS, NLA (CredSSP with NTLM/Kerberos) and several bitmap codecs; that is not reasonable here, so Keeper starts the system's client or FreeRDP with the options mapped: size or full screen, all monitors, resize with the window, clipboard, your home folder as a drive, sound here/there/off, Network Level Authentication, the admin (console) session, certificate handling (trust on first use, or accept any), and a Remote Desktop Gateway (FreeRDP 2 and 3 spellings). Embedding FreeRDP inside the Keeper window (`/parent-window:`) was not attempted: Electron gives no child X11 window to embed into, and drawing into the top-level window would cover Keeper.

**SSH** runs the system's `ssh` in a Keeper terminal tab, with jump hosts (`-J`, a chain), X11 forwarding, agent forwarding, saved `-L`/`-R`/`-D` forwards, a key file, and the sign-in method (agent, key, password, keyboard-interactive). On first connection Keeper fetches the server's key, shows its SHA256 fingerprint to compare, and on *Trust* records it in `~/.ssh/known_hosts`; a changed key is refused with an explanation. (Behind a jump host Keeper cannot see the key itself; ssh asks in the terminal.)

**Web consoles** open in a page view laid over the tab, with cookies kept per connection. A self-signed certificate can be trusted for that console only by its fingerprint; once pinned, any other certificate is refused, even one the system trusts. Pop-ups (a KVM button) open in the same view. While the console is shown, Keeper's own pop-ups appear behind it, so the certificate question hides the page first.

### Passwords

Passwords go into the system keychain through Keeper's secret store (Electron safeStorage), never into the connections file. Where there is no keychain (Linux without a keyring) Keeper asks each time. *Ask every time* is a per-connection choice. A password in an imported .vnc file goes straight into the keychain.

Passwords never go on a command line. FreeRDP reads it from standard input (`/from-stdin:force`); SSH and Mosh get an `SSH_ASKPASS` helper that answers only password prompts from a private file (mode 0600, in a private temporary folder, removed after a minute); TigerVNC reads a scrambled password file (0600); `remote-viewer` reads a 0600 .vv file it deletes itself. `mstsc`, the Mac's Remote Desktop app, X2Go and PowerShell ask for the password themselves.

### Gateways

- **SSH**: a jump host for SSH and Mosh; for VNC, RDP and the rest, a tunnel made in Keeper (ssh2) with the gateway's key checked against `~/.ssh/known_hosts`.
- **HTTP or SOCKS5 proxy**: Keeper listens on 127.0.0.1 and dials through the proxy (CONNECT or SOCKS5, with an optional user name).
- **Keeper Link**: a Keeper Link port forward to a paired device (`link.addForward`), removed when the session ends. Nothing is opened to the internet. Use `localhost` to reach the device itself; that device must allow *Reach ports on this computer*.
- **Mesh**: just another address for the same computer; SSH still checks the key under the real name.

### Import and export

`.rdp` (including UTF-16 files saved by Windows), `.vnc` (RealVNC/TightVNC/UltraVNC style), `Host` entries in `~/.ssh/config` (wildcard patterns are skipped; HostName, User, Port, IdentityFile, ProxyJump, ForwardX11, ForwardAgent and the three kinds of forwards are kept), and Keeper's own JSON (`keeper-remote-desktops`, version 1). Exports never contain passwords.

## Where it appears

Remote Desktops → *Where it appears* chooses each place:

- **Quick connect from anywhere**: a global shortcut (`Ctrl/⌘+Alt+R` by default, changeable) opens a small box: type an address or pick a favourite or recent connection.
- **Command palette**: *Quick Connect to a Remote Desktop…* and *Connect to …* for each saved connection.
- **Tray menu**: *Remote Desktops* with Quick Connect, favourites, recent connections, and what is open now with Show and Disconnect.
- **.rdp and .vnc files**: double-click opens them in Keeper (the packaged app declares both types without taking over as the default), and the file manager gets *Connect with Keeper* in the right-click menu: a per-user shell verb on Windows (`HKCU\Software\Classes\SystemFileAssociations\.rdp|.vnc\shell\KeeperConnect`), a desktop file, a KDE service menu and a Nautilus script on Linux. On macOS, Finder's *Open With → Keeper* sends the file to Keeper.
- **Live sessions**: VNC and web consoles open as tabs of the main window, or in windows of their own. A tab can always be moved to its own window from its toolbar.

## Making this computer reachable

*This computer* (switched on with **Let others reach this computer** in Settings → Features; off by default):

- **Windows**: Remote Desktop on/off (`fDenyTSConnections`), with Network Level Authentication and the "Remote Desktop" firewall group, all under one administrator prompt. Home editions cannot host; Keeper says so.
- **macOS**: Screen Sharing through `kickstart` (administrator). macOS 12.1 and later only let you grant screen control by switching it on in System Settings → General → Sharing yourself; Keeper explains and opens that page.
- **Linux**: GNOME Remote Desktop (`grdctl` RDP/VNC and its user service; set the user name and password in GNOME Settings, which also makes the certificate), KDE KRdp (its user service), or Keeper runs `x11vnc` (X11) or `wayvnc` (wlroots) while it is open, on this computer only by default, with the password in a private VNC password file.
- **Reach it through Keeper Link**: one switch per paired device lets it reach this computer's ports through Link, so nothing is opened to the internet.
- **Safety checklist**: Network Level Authentication, not open to every network (with the listening address read from `ss`/`netstat`), a password, and account lockout (Windows: 10 wrong tries, 15 minutes). Failing checks also appear in **To do**.

The settings catalogue (System Settings+) also gained GNOME's RDP and VNC sharing switches and service, and advice entries for macOS Screen Sharing and the Windows Remote Desktop firewall rule.

## The `keeper` command

```
keeper rdc list
keeper rdc connect <name | rdp://host | vnc://host:5901 | ssh user@host> [--external]
keeper rdc add <uri> [--name "Office PC"] [--folder Work]
keeper rdc import <file.rdp | file.vnc | ~/.ssh/config | connections.json>
keeper rdc export [--format json|ssh|rdp|vnc] [names…]
keeper rdc probe <host> [--ports 3389,5900,22]
keeper rdc host status | enable rdp | enable vnc [--password P] [--everywhere] | disable rdp|vnc
keeper rdc forward <name> --via-link <device> [--port N]
```

With the app open, `connect` uses saved passwords, opens VNC in a Keeper tab and asks host-key and password questions in the terminal; SSH, Mosh, Telnet, serial and PowerShell run right in the terminal you typed in. Without the app, `list`, `add`, `import`, `export`, `probe` and `connect` still work from the saved list (programs ask for passwords themselves). In Keeper's terminal, Ctrl+Space after `keeper rdc connect ` suggests saved connection names. `keeper rdc names` prints them for other shells' completion.

## Resources

Nothing runs while the page is closed: no timers, no sockets. Status knocks run only while a page asks for them. VNC asks for pictures only while a tab shows them. Every outside program is tracked (and listed for the watchdog) and stopped when Keeper quits; Link forwards and SSH tunnels close with their session.

## Verified and not verified

Verified on Linux (Ubuntu 24.04 under Xvfb) by `test/e2e/rdc.cjs`, with real servers:

- a real **x11vnc** (VNC password) on a second X display: the picture renders in a Keeper tab, the pointer moves the remote pointer, and typing reaches a text box on the remote screen;
- a real **sshd**: the first-connection fingerprint matches `ssh-keygen -lf`, *Trust and Connect* opens a terminal tab, a command runs there, and ssh asks nothing more;
- a UTF-16 **.rdp import**, and the exact `xfreerdp3` arguments for it;
- **FreeRDP 3** run against a port where nothing listens: the error comes back to the session, and the password is on its input, not in `/proc/*/cmdline`;
- a **.vnc file** opened as a double-click would (directly, and as an argument to a second launch), the **quick-connect window**, the **global shortcut** registration, the **command palette** entry and the **tray menu** contents (as data: Xvfb has no tray to screenshot);
- **through Keeper Link**: a second Keeper, paired, reaches the first one's VNC server through a Link port forward that goes away on disconnect;
- the status check stops when the page closes.

Unit tests (`test/rdc*.test.ts`) cover link parsing, .rdp/.vnc/ssh-config/JSON round trips, DES (the standard vector and x11vnc's stored password), known_hosts (plain, `[host]:port`, hashed, changed), the programs and arguments per system, the redaction check, the RFB handshake from recorded bytes and a tiny RFB server over TCP (Raw, CopyRect, RRE, Hextile, ZRLE, cursor, resize, clipboard, keys, pointer), the port knock, SOCKS5 and HTTP proxies, hosting parsers and plans, and the places.

Not verified (built, but not run against the real thing here):

- Windows (`mstsc`, the registry and firewall plan, the Explorer verb, PowerShell remoting) and macOS (`open` with .rdp, Screen Sharing fallback, `kickstart`), including the double-click file association in packaged builds;
- VeNCrypt/TLS sign-in (no TLS VNC server was available), web consoles against a real iDRAC/Proxmox (the certificate pin logic is in place), SPICE, X2Go, Mosh, Telnet, serial and `pwsh` launches (only their arguments are tested), GNOME Remote Desktop, KRdp and wayvnc switching, HTTP/SOCKS/SSH gateways for VNC/RDP end to end (the proxy dialling itself is tested), and Wake-on-LAN packets reaching a real machine;
- FreeRDP actually signing in to a Windows host;
- the tray menu as drawn by a real desktop.
