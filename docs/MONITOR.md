# System monitor

Keeper's system monitor works across the whole system, not only inside one window:

| Surface | What it does | Switch |
|---|---|---|
| **Menu bar / tray** | Live processor, memory, network, disk, graphics, temperature, power and battery readings. You can show them as one item or one item per reading, as a number, a sparkline or both. They turn amber or red under strain. Clicking a reading opens a **pop-over** with sparklines, the busiest apps and links to Health, History and the tool launcher. | Settings → Features → *Live readings in the menu bar* (off by default), then Health → Settings |
| **Island** | Apps that work hard for a long time show as an Island alert instead of a system notification. You can list "never alert about" apps. | Health → Settings → *Alerts in the Island* |
| **Global shortcut** | The **tool launcher** (default ⌃⌥Space / Ctrl+Alt+Space). Type to find any Toolbox tool, Convert tool or page, then press Enter to open it in a **small window that holds only that tool**. Recent tools come first. | Settings → Features → *Tool launcher*, plus the shortcut in Health → Settings |
| **Health page** (the home) | Overview with live tiles and a **Share card**, plus **History**, Processes, **Dev & agents**, **Containers**, **Sound & tabs**, **Sensors**, Services and **Settings** | Settings → Features → *Health* and its sub-features |
| **Command palette** | Health History, Dev Servers and Ports, Running AI Agents, Graphics/Fans/Power, Menu-bar Readings…, Tool Launcher | follows the features |
| **Tray menu** | *Tool Launcher…*, plus each reading's own menu | — |
| **CLI** | `keeper ps`, `top`, `kill`, `process`, `ports`, `dev`, `agents --running`, `containers`, `volume`, `sensors`, `history`, all with `--json` | — |
| **AI abilities** | `system_readings`, `health_history`, `dev_servers`, `running_agents`, `containers` and `process_details` are read-only. `process_control`, `stop_dev_server`, `stop_agent_session` and `container_action` ask first and carry a required *reason* that the person sees. | Settings → Abilities |

The same settings also appear in Settings → *System monitor*.

## Cost

- **No live readings run while nothing looks.** A monitor page, the pop-over and the menu-bar readings each register as a looker, and the fastest one sets the pace. With no lookers there is no timer at all. Readings go through the governor (`poll('monitor-live')`): they slow down 3× while you are away and stop while the screen is locked. A page that is hidden or minimised stops its readings.
- **Live readings are cheap.** Processor and memory come from `os.cpus()`/`/proc/meminfo`. Network and disk come from one small file read on Linux, one `netstat`+`iostat` on a Mac, or one question to Keeper's already-open PowerShell on Windows. Graphics, temperature and power are read only when one of those readings is shown.
- **History adds no timer.** Health already looks at running apps once a minute. It now runs through the governor, at the same rate as before. That look also feeds the history store with network and disk counters, plus graphics, temperature and power when *Graphics, fans and power* is on.
- **Writes are spread out.** The history file is written every five minutes and when Keeper quits. The old one-day file used to be written every minute; it is now written every five minutes too.
- The e2e test checks the idle budget: `perf-budget.cjs` measured 0.35% CPU idle (budget 0.6%) and 248 MB of memory (budget 520 MB).

## Long-term history

`core/monitor-history.ts` is pure and unit-tested.

| Tier | Resolution | Kept |
|---|---|---|
| 1m | every minute | 2 days |
| 5m | 5 minutes | 14 days |
| 1h | hourly | the retention setting (30 / 90 / 180 / 365 days) |
| 1d | daily | the retention setting |

- **What a point holds.** Each point has the average and busiest-minute processor and memory, network in/out, disk read/write, graphics, power, the hottest temperature and battery. Missing readings are NaN ("not measured"), not zero.
- **Per-app use.** This is kept hourly: the 24 apps that did the most processor work each hour, with peak memory. Helpers are folded into their app.
- **Storage.** A compact binary file (`monitor-history.bin`: a minute stamp, a count and 12 float32 values per point, about 54 bytes). A full year is about 1 MB; the tests check this. A damaged file reads as empty.
- **Charts.** They use the finest tier that covers the range and fits the chart. Drag across a chart to zoom in, and use *Zoom out* to go back. Ranges run from 1 hour to 1 year.
- **Extras.** Peaks with their time, *Worked hardest*, *Export CSV* and *Delete all history*. The old one-day history is imported once.

## Process details

The Inspect dialog in Health → Processes now also shows:

| | macOS | Windows | Linux |
|---|---|---|---|
| Open files, connections, children, memory breakdown | ✅ `lsof` (existing) | connections ✅; open files ❌ (needs a kernel handle walk) | ✅ `/proc` |
| Parent chain | ✅ | ✅ | ✅ |
| Listening ports | ✅ `lsof` | ✅ `Get-NetTCPConnection` | ✅ `/proc/net/tcp` + fds |
| Environment, hidden by default (setup values only; *Show values* reveals the rest; anything that looks like a password, token, key or credential URL needs a second *Show secrets too*) | ✅ `ps -E` (own processes) | ❌ no public API without reading process memory | ✅ `/proc/<pid>/environ` (own processes) |
| Code signature | ✅ `codesign`: signer, Team ID, identifier, hardened runtime, sandbox, notarisation, validity | ✅ `Get-AuthenticodeSignature`: signer, validity, part of Windows | ✅ better: the system package that installed it (`dpkg -S` / `rpm -qf` / `pacman -Qo`); Linux has no code signatures |
| Energy impact | estimate (existing column) | estimate | estimate |

AI abilities never receive environment values.

## Coding agents and dev servers

`core/agents-detect.ts` is one table of about 45 agents. The Island, the CLI, abilities and Health all read it.

| Group | Agents |
|---|---|
| Terminal agents and AI CLIs | the two existing ones (same ids), Gemini CLI, Aider, OpenCode, Cursor Agent, Copilot CLI, Amp, Goose, Kiro CLI, Qwen Code, Crush, Cline, Droid, Augment, Plandex, Open Interpreter, Grok CLI, Antigravity CLI, llm |
| Editors with agents | Cursor, Windsurf, Kiro, Antigravity, Trae, Zed, the Copilot language server, Codeium, Continue, Tabnine |
| Local model servers | Ollama, LM Studio, llama.cpp, llamafile, vLLM, SGLang, MLX, LocalAI, Jan, KoboldCpp, text-generation web UI, GPT4All, Tabby, Open WebUI |

How detection works:

- A process matches by its exact name, or by its command line for Node and Python agents run by script path. Generic names such as `server` and `chat` count only when the command line agrees.
- An agent's helpers fold into one session, which carries everything it started.
- **Quit session** ends the whole tree.

Dev servers work like this:

- Every listening TCP port is mapped to its process, the process's working folder, and that folder's **git root**, and then grouped by project.
- Each server gets a kind (Vite, Next.js, Django, PostgreSQL, Redis and so on), a link for web servers, an *idle* flag (no connections and no processor use) and an *open to the network* flag (bound to every address).
- **Open**, **Stop**, **Restart** and **Stop project** are available. Restart runs the same program and arguments in the same folder, and is refused for databases.
- Windows does not publish other programs' working folders, so the first existing folder in the command line is used instead.

**Protected folders:** Health → Settings → *AI agents may never stop programs in*. Agents get a refusal for any process working there, even when the person would approve.

## Graphics, fans and power (public interfaces only)

| | macOS | Windows | Linux |
|---|---|---|---|
| GPU use | ✅ `ioreg` IOAccelerator *Device Utilization %* (public registry; no IOReport) | ✅ `GPU Engine` performance counters; NVIDIA via `nvidia-smi` with memory, temperature, power and processes | ✅ NVIDIA `nvidia-smi`; AMD `gpu_busy_percent` + VRAM; Intel clock share of maximum (labelled *estimated*) |
| Temperatures | ❌ needs the private SMC; stated on the page | ✅ ACPI thermal zones where published | ✅ hwmon (with labels and limits) |
| Fan speeds | ❌ private SMC; stated | 🟡 `Win32_Fan` only when the maker fills it in; otherwise a kernel driver would be needed, which Keeper does not install | ✅ hwmon `fan*_input` |
| Fan control | not built on any system (it is on the "do not build" list) | — | — |
| Power draw | ✅ battery `InstantAmperage × Voltage` | ✅ WMI `BatteryStatus` discharge/charge rate | ✅ battery `power_now` (or current × voltage) + **RAPL** package/core/uncore/dram watts when `energy_uj` is readable |

The Sensors tab always lists what this computer cannot show.

## Tool launcher, tool windows, standard output folder

- **Launcher.** `core/tool-catalog.ts` lists every Toolbox tool (a test checks each id against the Toolbox source), every Convert tool (read from Convert's own table) and the main pages. It also holds the search ranking. Pages open in the main window.
- **Tool windows.** Each tool opens in its own small window (`view=tool`), stepped so windows do not cover each other. The window shows only that tool, with a *Tools* button that opens the launcher again. Turn *Tools open in their own window* off to use the main window instead.
- **Results go to.** One standard output setting: *Next to the originals* (Keeper's usual new folder, the default), *Dated folder* (a new `YYYY-MM-DD HH.MM <tool>` folder in Downloads/Keeper, or a folder you choose, never reused) or *One folder*. Convert uses it whenever a job has no folder of its own. The command line keeps results next to the originals.

## Processes list extras

- **Regex filter.** Type `/pattern/flags` in the filter box. It is case-insensitive unless flags are given, and a broken pattern turns red.
- **Pin to Top.** Available from the right-click menu; pinned programs (by name) stay at the top in every sort.
- **New and Ended.** Processes started in the last minute carry a **New** mark. Processes that ended show under **Ended recently** for two minutes.
- **CSV.** Saves the current list.
- The CLI has the same regex filter (`keeper ps /regex/`).

## Containers

- **Engines.** Docker, or Podman when Docker is not answering. Each engine's JSON formats are parsed (`core/monitor-containers.ts`).
- **What it shows.** Each container with its state, processor, memory, network and disk I/O and processes (`stats --no-stream`), plus the engine's disk use (`system df`) with what could be freed.
- **Actions.** Stop, start, restart, pause and resume, after a confirmation.
- **For agents.** The `containers` ability is read-only. `container_action` asks permission and needs a reason.
- **Cost.** Nothing runs unless the tab is open. Switch: *Containers*.

## Sound & tabs

| | macOS | Windows | Linux |
|---|---|---|---|
| Apps playing sound | ✅ keeper-helper `audio.processes` (the public process object list, macOS 14.2+) | ✅ | ✅ |
| Volume and mute per app | 🧪 experiment, off by default (see below) | ✅ Core Audio sessions (`ISimpleAudioVolume`) through a C# helper that PowerShell compiles in memory, run in Keeper's long-lived PowerShell; extends App controls' volume code | ✅ PipeWire / PulseAudio `pactl` sink-inputs (volume, mute) |
| Output device | ✅ keeper-helper `audio.setOutput`: the public, settable `kAudioHardwarePropertyDefaultOutputDevice` property (AudioHardware.h) | ❌ switching is only possible through an undocumented interface (`IPolicyConfig`), so Keeper does not offer it | ✅ `pactl set-default-sink` |
| Each app to its own output | — | ❌ undocumented interface | ✅ `pactl move-sink-input` |
| Each app keeps its volume and output | 🧪 with the experiment | Windows keeps it itself | ✅ *Sound for each app* |
| Browser tabs by memory and data | ✅ | ✅ | ✅ |
| Energy impact, sleep assertions, App Nap per app | ✅ | — | — |

**Browser tabs.** These come from Keeper's browser extension link (the `browser-tabs` service), using the memory each page reports (an estimate) and the data it loaded. Tabs are sorted by memory, and each can be put to sleep. Incognito tabs are never listed.

**macOS energy.** This uses only public tools:
- Energy impact comes from `top -stats pid,command,power` (the same figure Activity Monitor shows).
- Sleep assertions per process come from `pmset -g assertions`.
- App Nap is the documented `NSAppSleepDisabled` preference (`defaults write <id> NSAppSleepDisabled -bool YES`). It takes effect the next time the app starts.

**Output device on macOS.** Re-checked: `kAudioHardwarePropertyDefaultOutputDevice` is a documented, settable property of the system object in Core Audio's public `AudioHardware.h`, so switching the output is public. keeper-helper's `audio.outputs` lists devices with output channels and `audio.setOutput` sets one by its UID; the Output menu in Sound & tabs now works on a Mac.

**Volume for each app on a Mac (experiment).** macOS still has no per-app volume setting. Since macOS 14.2 the public process-tap interface (`CATapDescription`, `AudioHardwareCreateProcessTap`) can capture one app's sound and, with `muteBehavior = mutedWhenTapped`, silence its own output while it is captured. The *Volume for each app on a Mac (experiment)* part (`macAppVolume`, off by default, Settings → Features → Computer, shown with advanced settings) uses that:
- For an app whose volume you change, keeper-helper creates a private tap on that app and a private aggregate device on the current output, and plays the tapped sound again at your level (0–150%). Back at 100% and not muted, the tap and the device are removed and the app plays as before.
- No audio driver is installed (consistent with the settings catalogue's choice). It needs the system's audio recording permission (Privacy & Security → Screen & System Audio Recording; Keeper's Info.plist explains why), adds a little delay, and switching the output moves each tapped app with it.
- The Swift code (`Audio.swift`) is written against the public headers and has not been compiled or heard on a real Mac yet.

**Sound for each app.** With *Sound for each app* (`soundPerApp`, off by default), a volume, mute or output you give an app in Sound & tabs is kept for that app (by name, in `<userData>/sound-rules.json`) and set again when it next plays. Linux hears new streams from the sound server's own event stream (`pactl subscribe`, one small process while on, no polling); a Mac with the experiment looks every 5 seconds; Windows keeps each app's volume itself, so nothing runs there. A stream is set once when it appears, never again, so a change made elsewhere is not undone. **Forget** on a row lets the app go.

## Share card

Health → Overview → **Share card…** draws a 1200×630 picture of the current readings. It shows up to six tiles with sparklines, in light, dark or transparent. You can **Copy** it as an image or **Save PNG…**. The layout is pure (`core/monitor-share.ts`); the page draws it on a canvas.

## More AI usage providers

`core/island-tools/usage.ts` adds three providers to the Island's usage meter:
- **Ollama** (`/api/ps`): loaded models, the memory they hold and when they unload.
- **LM Studio** (`/api/v0/models`): loaded models.
- **Antigravity**: no local record, so it points to its own settings.

Both servers are asked on localhost only. Gemini CLI, Qwen Code and OpenCode come from the ISLAND workstream's `usage-more.ts`.

## Files

| Part | File |
|---|---|
| History store, rollups, file format | `core/monitor-history.ts` |
| Menu-bar settings, formatting, strain, icon pictures | `core/monitor-tray.ts` |
| Agent table and detection | `core/agents-detect.ts` |
| Dev-server grouping, kinds, restart plan | `core/monitor-devservers.ts` |
| Sensor parsers | `core/monitor-sensors.ts` |
| Environment redaction, parents, signatures | `core/monitor-procinfo.ts` |
| Launcher catalogue and output folder | `core/tool-catalog.ts` |
| Containers, mixer, macOS energy, share card | `core/monitor-containers.ts`, `core/monitor-mixer.ts`, `core/monitor-energy.ts`, `core/monitor-share.ts`; I/O in `electron/services/monitor-extras.ts` |
| Local model usage | `core/island-tools/usage.ts`, `electron/services/monitor-usage.ts` |
| API types | `core/api-sysmon.ts` |
| System reading (no Electron, shared with the CLI) | `electron/services/monitor-probe.ts` |
| Live readings | `electron/services/monitor-live.ts` |
| History service | `electron/services/monitor-history.ts` |
| Menu-bar items and pop-over | `electron/services/monitor-tray.ts` |
| Launcher, tool windows, output folder | `electron/services/monitor-launcher.ts` |
| Settings file | `electron/services/monitor-settings.ts` |
| IPC, abilities, CLI methods | `electron/ipc/sysmon.ts` |
| Pages | `src/screens/monitor/*`, `src/screens/Health.tsx` |
| Demo | `src/mock-sysmon.ts` |
| CLI | `cli/monitor.ts` |
| Sound for each app, Mac outputs and processes | `core/sound-rules.ts`, `electron/services/sound-rules.ts`, `native/macos/KeeperHelper/Sources/keeper-helper/Audio.swift` |
| Tests | `test/monitor-*.test.ts` (77), `test/sound-rules.test.ts` (8), `test/e2e/monitor.cjs` (54 checks), `test/e2e/sound.cjs` (15 checks) |

## Feature status

| Item | macOS | Windows | Linux | Status |
|---|---|---|---|---|
| Per-metric menu-bar items with text and graphs, red under strain | text + template graph | icon with number + graph, tooltip | icon with number + graph, menu with readings | ✅ built |
| Pop-over of details | ✅ | ✅ | ✅ (also from the tray menu, since some Linux trays do not report clicks) | ✅ better than a fixed dropdown |
| History up to a year, rollups, zoom, peaks, per-app, CSV | ✅ | ✅ | ✅ | ✅ better (5-min/hourly/daily tiers, drag-zoom) |
| Process inspector: signature, parents, ports, env | codesign | Authenticode | package owner | ✅ (Windows env not possible) |
| CLI ps/top/kill/process/ports/dev/sensors/history | ✅ | ✅ | ✅ | ✅ |
| AI quit/kill/suspend behind permission, reason, protected folders | ✅ | ✅ | ✅ | ✅ |
| Agent detection (about 45 agents, editors and model servers) | ✅ | ✅ | ✅ | ✅ better |
| Dev servers by project, idle/exposed flags, open/stop/restart/stop project | ✅ | 🟡 folder guessed from the command line | ✅ | ✅ |
| GPU use | ✅ ioreg | ✅ counters / nvidia-smi | ✅ | ✅ (Intel on Linux is an estimate) |
| Fans and temperatures | ❌ not public | 🟡 where published | ✅ | partial by OS limits |
| Power draw | battery | battery | battery + RAPL | ✅ |
| Fan control | — | — | — | not built (unsafe, private APIs) |
| Global tool launcher, single-tool windows, standard output folder | ✅ | ✅ | ✅ | ✅ |
| Process list: regex, pins, New/Ended, CSV | ✅ | ✅ | ✅ | ✅ |
| Containers: stats, system df, actions, agent permission | ✅ | ✅ | ✅ | ✅ (Docker or Podman) |
| Volume per app | 🧪 process taps, experiment | ✅ | ✅ | ✅ (macOS experimental) |
| Output device switch | ✅ public property | ❌ undocumented | ✅ | ✅ macOS and Linux |
| Each app to its own output, kept per app | — | Windows keeps volumes | ✅ | ✅ Linux |
| Per-tab browser memory and data | ✅ | ✅ | ✅ | ✅ (extension estimate) |
| Share card PNG | ✅ | ✅ | ✅ | ✅ |
| Energy impact, assertions, App Nap toggle | ✅ | — | — | ✅ (macOS idea) |
| Local model servers in AI usage | ✅ | ✅ | ✅ | ✅ |

## Verified

- **Linux, real app** (`xvfb-run -a node test/e2e/monitor.cjs`), all 54 checks pass:
  - no readings while nothing looks, and they start and stop with Health and the pop-over;
  - history records points with network counters, and its charts draw;
  - a dev server in a git project is grouped by git root, then restarted on the same port as a new process and stopped with its project;
  - a fake agent is detected with its child, and quitting the session ends both;
  - the inspector shows parents and ports; the environment hides a token by default, still hides it after *Show values*, and shows it only after the second step;
  - the `process_control` ability is refused for a protected folder;
  - menu-bar items: one combined item, then one per reading in order, with drawn pictures, and none when switched off;
  - the pop-over opens; the launcher opens, finds a tool and opens it in its own window, and remembers it;
  - the CLI's `ps`, `kill --suspend/--force` and `ports` work;
  - containers and the mixer run their real code paths against stand-in `docker` and `pactl` programs: live use, disk use, the `container_action` ability restarting a container, volume, mute and switching the output reaching the sound server;
  - a regex filter finds a new process marked New, it can be pinned, and it appears under Ended recently after it stops;
  - the share card draws a 1200×630 picture;
  - there are no page errors.
- `perf-budget.cjs` passes: 0.33% idle CPU and 389 MB of memory, against budgets of 0.6% and 520 MB.
- **Screenshots** (light and dark, 1440×900 and 820 px wide) of every tab, the pop-over, the launcher and a tool window. The browser demo was checked too.

## Not verified on real hardware

- **macOS:** `top` power and `pmset` assertions, App Nap writes, the menu-bar title and template image, `ioreg` GPU and battery power, `codesign` parsing (unit-tested against sample output), `ps -E` environment, `lsof` listeners and working folders.
- **Windows:** the Core Audio mixer helper, the tray icon pictures, GPU Engine counters, WMI battery rate and fans, `Get-AuthenticodeSignature`, `Get-NetTCPConnection` listeners and the command-line folder guess.

Parsers for all of these are unit-tested against sample output. Linux NVIDIA, AMD, Intel and RAPL readings were tested from sample sysfs and command output only (this machine has none). Real Docker, Podman and PipeWire were not available here; stand-ins were used.
