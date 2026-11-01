<!-- SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0 -->
# Keeper security review (0.1.0, November 2026)

A first-party review of the whole app, done before an outside audit. It covers what was looked at, how, what was found and fixed, what is left, and what an outside auditor should spend their time on.

Reporting a problem: see [SECURITY.md](../SECURITY.md).

## Scope

Everything in this repository that ships in the app or runs next to it:

- **Electron shell:** every `BrowserWindow` / `WebContentsView` (main, quick panel, Island, clips, pill, wallpaper and mixer, cue popup, launcher, tray popover, terminal and quick terminal, capture overlays, recorder, voice HUD, screen viewers and privacy screens, Stage overlays, guide, widgets, restore windows, print/convert windows, the browser, remote web consoles), navigation and window-open handling, the CSP in `index.html`, `shell.openExternal`, the `keeper-file:` protocol.
- **The preload and IPC:** the methods exposed in `electron/preload.ts` and the handlers behind them.
- **Command execution:** everything that starts a process, with special attention to PowerShell, AppleScript/JXA and `sh -c` strings; the settings catalogue, per-app controls (appctl), Stage, the system monitor, remote-desktop clients.
- **Privilege boundaries:** the elevate service (pkexec, the macOS administrator dialog, UAC), the mesh helper, the unattended screen service, files written as the administrator.
- **Keeper Link:** pairing, the channel, Help mode, the browser helper, the direct UDP path, per-device permissions, the relay (Node and Cloudflare Worker), Mailbox notes, the phone companion, remote commands, printing and terminals.
- **Remote screens:** consent, input sanitising, unattended access.
- **Mesh:** the privileged helper's plan guard, DNS responder, hosts file.
- **AI:** abilities (allow / ask / off), prompt-injection paths, computer use, the MCP socket and HTTP API, the agents gateway, the agent terminal bridge.
- **Local servers:** every listening socket.
- **Previews:** HTML, SVG, Markdown, notebooks, mail, archives, CAD, documents.
- **Secrets, updates and downloaded tools, the browser extension and native host, dependencies.**

Out of scope: the telemetry Worker's hosting, GitHub and Cloudflare account security, and the operating systems' own tools.

## Method

- Read the code paths above end to end, starting from every place untrusted data enters: files on disk (names and contents), archives, mail, web pages, notes from sync connectors, other paired devices, the network (Link port, relay, mDNS, UDP), other programs on the same computer (sockets, environment), and text produced by AI models.
- Grepped for every sink class: `spawn`/`exec` with `shell: true` or a built string, `powershell`/`osascript`/`sh -c` builders and their quoting helpers, `innerHTML`/`dangerouslySetInnerHTML`/`srcdoc`, `listen(`/`bind(`, `fetch(` of executables and models, `openExternal`, `webPreferences`.
- Checked each finding with a concrete scenario, fixed what was medium or above (and cheap low ones), and added a regression test for each fix in `test/security-review.test.ts` (plus updated expectations in existing tests).
- Ran `npm audit --omit=dev` and assessed every high and critical.

## Findings

Severity: **High** — code execution or a privilege change from data an attacker can plausibly deliver. **Medium** — needs a second step, a local foothold, or gives a strong primitive (DoS of the app, a password oracle, an unprotected root action). **Low** — defence in depth or hard to reach.

| ID | Sev | Area | Finding and scenario | Status |
| --- | --- | --- | --- | --- |
| F1 | High | Command execution (Windows) | 33 PowerShell builders escaped only `'` inside single-quoted literals. PowerShell also ends a literal at `‘ ’ ‚ ‛`. A downloaded file named `report’; Start-Process calc; ’.docx` ran code when Keeper converted it to PDF with Word, checked its Authenticode signature during a security scan, showed its version info in a preview, moved it to the Recycle Bin, copied it to the clipboard, zipped it, printed it for another device, set it as wallpaper, or passed it to the elevated batch (as administrator). | **Fixed**: every builder now doubles all five quote characters (`core/*`, `electron/services/*`); `quotePath(…, 'powershell')` also quotes names with curly quotes. Test: a PowerShell-literal reader round-trips nasty names through the helpers, and a source scan fails on the old pattern. |
| F2 | Medium | Link Help mode | The code is ~30 bits and is recoverable from the mDNS tag (anyone on the network) or the Mailbox topic (the Mailbox operator). The password (~28 bits) could then be guessed offline in seconds from either the helper's first HMAC (after spoofing the host's mDNS announcement) or the sealed Mailbox note. The attacker would then connect to the real host as "the helper". | **Fixed**: protocol v2 derives the confirm key and the note key with scrypt (N=2¹⁵, r=8: ~0.1 s per guess, so ~4·10⁸ passwords are far out of reach in 10 minutes). Hosts still answer v1 helpers and v1 notes are still read; only v2 is written. A helper reads at most the 50 newest notes. Test: v2 notes, v1 compatibility. |
| F3 | Medium | Keeper Relay | No limit on calls waiting for one device (each one makes that device open a new connection), 64 × 16 MB of early data buffered per call (about 1 GB per call), no limit on connections that have not proved their id. | **Fixed** in `core/link/relay.ts` and the Cloudflare Worker: 8 waiting calls per device, 2000 in all, 256 KB early data per call, 1000 unproven listeners. Tests: early-data cap, per-device cap. |
| F4 | High | Archive preview | Unpacking one entry for preview fell back to `tar -xf <archive> -C <dir> <entry>` (and 7z/unrar) with the entry name from the archive. An entry named `--to-command=sh -c '…'` in a `.tar.xz` ran a command when clicked. | **Fixed**: `extractCommands()` puts `--` before names for every tool. Test. |
| F5 | Medium | Archives | `unzip`/`untar` (FileKit unpack) and preview extraction inflated without a total bound; a small "zip bomb" took the main process down. | **Fixed**: 2 GB cap for unpacking, bounded inflation everywhere (preview entries bounded by what is asked for). Test. |
| F6 | Medium | Link remote print | Printing for another device used the Windows shell's Print verb on any file type the other device named (scripts, shortcuts, macro documents open in their apps). | **Fixed**: only PDFs, pictures, text and Office documents without macros are printed; others are refused and logged. Test. |
| F7 | Medium | Mesh helper (root) | The helper accepted `tee /etc/hosts` with any content, so any program running as the person could redirect any host name for every user without a password once the mesh was on. | **Fixed**: the helper only lets Keeper's own block change, with mesh (ULA) addresses and plain names; a stale cleanup removes the block instead of failing (so routes and DNS are still restored). Test. |
| F8 | Medium | Updates | macOS (.dmg) and Linux (.deb/.rpm) updates were installed without a checksum or signature check (the Mac copy had its quarantine removed; packages were installed as root). `KEEPER_UPDATE_FEED` accepted plain http from anywhere. | **Fixed**: the download is checked against the release's `SHA256SUMS.txt` (required in official builds); the new Mac app must pass `codesign --verify --deep --strict` and, when this copy has a team id, carry the same one; the feed must be https or this computer. Test: checksum parsing, feed rule. |
| F9 | Medium | Windows | No global navigation or window-open guard. Several windows that carry the full preload (terminal, quick terminal, capture overlay, Places quick panel, screen viewers, guide, recorder) had no `will-navigate` or `setWindowOpenHandler`: a dropped file or link, or a `target=_blank` link, would load other content with the whole API, and `window.open` children inherit the preload. | **Fixed**: `electron/nav-guard.ts` (installed first thing in `main.ts`): Keeper's own pages only navigate to Keeper's page, open web/mail links in the browser and never open child windows; `<webview>` is refused everywhere. Windows that show web pages on purpose are unaffected. Test for the URL rules. |
| F10 | Medium | Agent terminal bridge | Messages between agents were typed into an agent's terminal when the screen "looked idle", including a plain shell prompt. If the agent program had quit, a message (from another agent, possibly steered by a web page it read) ran as a shell line: `$(…)`, `;`. | **Fixed**: delivery needs the program's own prompt and a running session, checked again before each message. Test. |
| F11 | Medium | Per-app controls | A process id from the window and cgroup paths were put into `sh -c` strings run as root. | **Fixed**: the id must be a positive integer; paths go in as arguments (`sh -c 'echo "$1" > "$2"'`). |
| F12 | Medium | Mail | Opening an attachment handed it straight to the system, so a `.exe`, `.js`, `.lnk`, `.hta` or macro document would run. | **Fixed**: those kinds are shown in their folder instead. Test. |
| F13 | Low | Previews / mail | The compose preview and release notes removed scripts with regular expressions (bypassable); the trip print frame was an unsandboxed `srcdoc`. The main window's CSP already blocked inline script. | **Fixed**: DOMPurify (`sanitize`) for both, `sandbox` on the print frame. |
| F14 | Low | Link permissions | `allowed()` used `in`, so inherited names (`constructor`, `toString`) counted as known methods (they still needed a permission, so nothing ran). | **Fixed** (`Object.hasOwn`). Test. |
| F15 | Low | Places & Tracks receiver | Token compared with `===` (timing), and an empty token would match `?token=`. | **Fixed**: constant-time, at least 16 characters (Keeper makes 16). Test. |
| F16 | Low | Voice HUD | The pill window ran with `sandbox: false` for no reason. | **Fixed** (`sandbox: true`). |
| F17 | Low | AppleScript | Removing a login item escaped `"` but not `\` in its name. | **Fixed**. |
| F18 | Low | PowerShell | The WireGuard tunnel switch and the mouse "reverse wheel" setting built double-quoted PowerShell strings, so `$…` expanded (the second was also simply broken). | **Fixed** (single-quoted). |
| F19 | Low | Downloads | The background-removal model was downloaded without a hash. | **Fixed**: pinned SHA-256 (its MD5 matches rembg's published one). |
| F20 | Low | Firewall | `KEEPER_FW_FAKE` / `KEEPER_FW_TEST_CA` worked in official builds: an environment variable could swap enforcement for a test double. | **Fixed**: test builds only. |
| D1 | High | Dependencies | `sharp` 0.34.5 bundled libvips, libheif and librsvg with published CVEs; Keeper decodes untrusted pictures with it (previews, thumbnails, conversions). | **Fixed**: upgraded to sharp 0.35.5 (libvips 8.18.7). The conversion, thumbnail and preview tests pass on it, and so does a packaged Linux build. The type import changed (`typeof import('sharp').default`). On Linux, sharp now prints a one-line warning under Electron about libraries Electron ships; the image paths were checked end to end. |
| D2 | Low | Dependencies | `request`, `form-data`, `tar`, `node-gyp` (critical/high in `npm audit`) came only through `dbus-next → usocket → node-gyp`, used when building usocket's optional native part, never at run time. `xml2js` 0.4 (prototype pollution) parsed D-Bus introspection XML from local services. | **Fixed**: `package.json` overrides pin usocket's `node-gyp` to ^12.4.0 (which drops `request`) and `xml2js` to ^0.6.2. |
| D3 | Medium | AI abilities | `fetch_page` and `web_search` are Allow by default, and so are reading documents and memories. A prompt injection in a page or document can make the model put private text into a URL and "read" it: a quiet exfiltration channel. Pages are wrapped as untrusted data and look-alike tool calls are flagged, but nothing stops this. | **Owner decision** (see below). |
| D4 | Low | AI abilities | `fetch_page` resolves the host, checks for private addresses, then fetches (which resolves again): DNS rebinding can reach the local network. | Open: pin the checked address in the request (a custom `lookup`). |
| D5 | Medium | Link browser helper | The web helper's key is HKDF(code ‖ password) with no key exchange (pure-JS page on plain http). Anyone on the local network who records a session can recover the code from the mDNS tag and guess the password offline. Documented in REMOTE.md. | **Owner decision**: scrypt in the page's JS, a PAKE, or https-only for the web helper. |
| D6 | Low | Privilege | The Windows elevated script is written to the person's own `userData` before the UAC prompt; on Linux, pkexec runs the mesh helper from the app's folder (user-writable for tar.gz installs). Malware already running as the person could swap them between write and run (UAC is not a security boundary on Windows, but this still turns a yes into something else). | Open: write to an administrator-only folder from the elevated side, or check a hash inside the elevated process. |
| D7 | Low | Windows | The capture overlay is a `data:` page with the full preload. Window titles are stripped of `<>&` and ids of quotes, so nothing is injectable today. | Open: give overlays a two-method preload. |
| D8 | Low | Renderer | The app runs from `file://`, where CSP `'self'` allows any local file as a script source; the notes sanitizer allows `<iframe>` to `127.0.0.1`. No injection was found that reaches either. | Open: serve the app from a custom `app://` scheme; drop iframes from notes. |
| D9 | Low | Storage | The mail cache is written with the default file mode (other local accounts may read it where home folders are shared); Link data and secrets are 0600. | Open: write PIM files 0600. |
| D10 | Low | `keeper-file:` | Serves any file in the library folders with `access-control-allow-origin: *`; only the default session (Keeper's own pages) has the scheme. | Accepted. |
| D11 | Info | Monorail | Install checks the release checksum and the code signature, and pins the certificate on first install (trust on first use). | Accepted; pin the team id once Ashforde signs it. |

Checked and found sound (no change): context isolation and sandbox on every window (besides F16); `openExternal` only for http(s)/mailto (plus fixed system settings URLs); the Brain MCP socket (0600, token) and HTTP API (token, Host and Origin checks against DNS rebinding); the agents gateway (token, Host/Origin checks, loopback); OAuth loopback servers (127.0.0.1, state); the Link handshake (SIGMA-I, pinned keys, per-message AES-GCM counters), pairing (commitment, SAS, 5 tries), per-device permissions, shared-folder path checks (realpath, no links); the phone companion (secret in the URL fragment, approval prompt, single-use invite); remote input (every event checked and clamped); the mesh plan guard's other rules; mail HTML (sanitised, sandboxed iframe with its own CSP); downloaded tools (cloudflared, scrcpy, yt-dlp, whisper models, wireguard-go are SHA-256 pinned); secrets (OS keychain only; refused on Linux's plain-text backend); the native messaging host (fixed extension ids, message parser); remote commands (exact command approved once per device); usage statistics (schema-checked payload, test hooks off in official builds).

## Dependencies / npm audit

`npm audit` on the lockfile reports **0 vulnerabilities**, and the lockfile has **no deprecated packages**, so `npm ci` prints no deprecation warnings.

- **sharp 0.35.5** (D1) clears the three advisories that were left against 0.34.5: GHSA-f88m-g3jw-g9cj (libvips, fixed in 0.35.0), GHSA-rgj7-g3m4-5g8c (libheif, 0.35.4) and GHSA-wq5f-xc86-pv6w (librsvg, 0.35.5).
- **Overrides** in `package.json` move the build tools off the old packages: usocket's `node-gyp` ^12.4.0 and `xml2js` ^0.6.2 (D2), `@electron/asar` 4, `@electron/universal` 3, `filelist` 2, `glob` 14, `minimatch` 11 (this removes the `minimatch` denial-of-service advisory inside `electron-builder`), `global-agent` 4, and `lodash.isequal` replaced by `fast-deep-equal` for `electron-updater`. `temp` (used only while building Windows installers) gets `tools/npm-compat/rimraf`, rimraf 2's API on Node's own `fs.rm`.
- **Install scripts:** the `allowScripts` map in `package.json` lists every dependency that has an install script and whether it is expected to run: on for `electron-winstaller`, `esbuild`, `ffmpeg-static`, `fsevents`, `node-pty`, `onnxruntime-node`, `sharp` and `usocket`; off for `ssh2`, `cpu-features` and `tesseract.js`, whose scripts only build optional native speed-ups or print a message, none of which Keeper needs. sharp 0.35 no longer has an install script (its prebuilt binaries come as `@img/sharp-*` packages), so its entry is harmless and can be dropped.
- Re-check with `npm audit` and `npm ci` whenever dependencies change; the release workflow installs with `npm ci` from this lockfile.

## Decisions for the owner

1. **Abilities and exfiltration (D3).** Options: make `fetch_page` *Ask* by default once a conversation has read local files or memories; or allow fetches only to hosts that came from a search result or the person's own message; or strip query strings from URLs the model built itself. Each costs some convenience.
2. **Browser helper (D5).** Keep it (documented), make it https-only (tunnel), or invest in scrypt/PAKE in the page.
3. **Help v1 compatibility (F2).** Hosts still answer v1 helpers (Keeper 0.1.0 before this change). Drop v1 in the next release.
4. **Updates without a team id (F8).** Mac builds are ad-hoc signed today, so only the checksum vouches for an update. Set up a Developer ID and pin the team id. The release workflow publishes `SHA256SUMS.txt` on every release (official builds now refuse a release without it).
5. **Remote print types (F6)** and **risky attachments (F12)** are allow/deny lists; widen them if people ask.

## Residual risks

- Prompt injection remains a model-level problem; Keeper limits what tools can do and asks for anything that changes things, but reading and fetching are allowed by default (D3).
- A program already running as the person can do most things the person can; the boundaries that matter are the administrator ones (F7, F11, D6) and other people on the network (Link, mesh, relay).
- The relay and Mailbox operators can see who talks to whom and when, and can drop traffic.
- Plain-http local pages (phone companion and browser helper on the local network) rely on keys only, with no transport security.

## Recommendations for an external audit

1. **Link and Help cryptography:** `core/link/channel.ts`, `pair.ts`, `help.ts`, `udp.ts`, `resume.ts`, `jscrypto.ts` (pure-JS ChaCha20-Poly1305 / X25519 / HKDF used by phone pages). Replay and reordering across resumable carriers; the UDP path's HMAC binding.
2. **The privileged parts:** `electron/services/mesh/helper.ts` with `core/mesh/plan-guard.ts`, `electron/services/elevate.ts`, `core/screen/unattended.ts` (service install), `electron/services/link/service.ts`. Try to make the helper do anything outside Keeper's interfaces.
3. **Every command builder** (PowerShell, AppleScript, `sh -c`) against hostile names, now that F1 is fixed: a fuzz harness that runs the builders through real PowerShell and `osascript` on CI.
4. **Renderer hardening:** move off `file://` (D8), audit every `dangerouslySetInnerHTML`, try to break DOMPurify configurations with mXSS.
5. **AI tool use:** red-team prompt injection through web pages, mail, notes from sync connectors and other agents (the hub), against the default ability permissions and computer use.
6. **Parsers of untrusted files:** the pure-TS readers (PDF, DOCX, ZIP, TAR, FIT, KML, DXF, EXIF, ID3) under a fuzzer, and the native ones (sharp/libvips, onnxruntime, ffmpeg) for version currency.
7. **Update chain:** Sigstore verification of `SHA256SUMS.txt` inside the app (today it only checks the hash from the same release).
