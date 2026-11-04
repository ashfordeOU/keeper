# Voice: dictation anywhere and meeting recording

<!-- SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0 -->

Voice lets you speak into any app and records meetings. Speech is recognised **on this computer** by default, using the same Whisper model (ONNX Runtime) that file transcription uses. Nothing is sent anywhere unless you pick a speech service, or let an online AI write meeting notes or edit text.

## Where it lives

One **Voice** page in the AI section has three tabs: **Dictation**, **Meetings** and **Snippets** (typed and said snippets are one list). The old routes, page windows and `keeper://open/dictation`, `meetings` and `snippets` still open their tab. Times on the page are written the way this computer writes them (16:07 or 4:07 pm).

| Surface | Dictation | Meetings |
|---|---|---|
| Anywhere | Hold the talk key (opt-in: *Hold a key to talk*), or press the shortcut (default `Ctrl/⌘ Shift ;`). The edit-by-voice shortcut is `Ctrl/⌘ Shift '`. | Offered when a call is noticed. |
| Floating pill (a non-focusing window in a chosen corner) | Live text as you speak, the app's tone, an optional review step, the edit-by-voice permission question | A small recording bar (pause, stop). The "Record this call?" card includes a consent reminder. |
| Island | A listening activity with the level and live words | A recording activity with the elapsed time and the last line, plus Pause and Stop. Calendar events get a **Record** button next to Join. |
| Menu bar / tray | Start/stop, edit selection, history | Record meeting / record the noticed call, Pause, Stop and save, live transcript |
| Command palette | Start/stop dictating, edit selection, Dictation page, history | Record, pause, stop, Meetings page |
| Pages (home for history and settings) | **Voice → Dictation**: status, statistics, history, dictionary, snippets, per-app rules, models, settings, and which surfaces it appears on | **Voice → Meetings**: record, live transcript, past meetings, speakers, notes, calendar link, settings; **Export** (notes as Markdown, the transcript as plain text, subtitles as SRT or VTT) and, under **More**, Delete |
| `keeper://` links | `keeper://dictation/toggle`, `/start`, `/stop`, `/cancel`, `/edit` | `keeper://meeting/start?title=…`, `/stop`, `/pause`, `/resume` |
| Command line | `keeper dictation [start\|stop\|toggle\|cancel\|status\|history\|stats]` | `keeper meeting [start\|stop\|pause\|resume\|live\|list\|export\|notes]` |
| AI abilities (permission-gated) | `dictation_history` | `meeting_live_transcript` (also needs *Let AIs read the live transcript*), `meeting_list`, `meeting_get`, `meeting_record` |

Feature switches (Settings → Features): `dictation` (on), `dictationHold` (**off**: it listens to a key), `meetings` (on, costs nothing until you record), `meetingDetect` (on; every 15 s it checks which app uses the microphone, reusing the Island's microphone check on Windows and Linux, and reads window titles only while something uses the microphone).

## Code

- `core/voice/`: pure, unit-tested logic. `tidy.ts` is the text pipeline, `numbers.ts` the number/time/money/date/email/link formatting, `keys.ts` the talk-key gestures and Linux hook parsers, `vad.ts` voice activity, `stream.ts` live-text agreement, `diarize.ts` voice prints and clustering, `meeting.ts` call detection, exports and notes, `history.ts` search and stats, `settings.ts`, `types.ts`.
- `core/whisper.ts` / `electron/services/whisper.ts`:
  - per-model token tables;
  - the optional **large-v3-turbo** model (128 mel, pinned SHA-256);
  - a byte-level BPE encoder, so the personal dictionary is fed to the model as a prompt;
  - `transcribeSamples()` for in-memory audio, queued and shared with file transcription.
- `electron/services/voice/`:
  - `index.ts`: the service (dictation, edit by voice, meetings, call detection, notes);
  - `keyhook.ts`, `system-audio.ts`, `insert.ts`, `engine.ts`;
  - `hud.ts`: the pill window, which also captures the microphone;
  - `store.ts`: plain JSON in `userData/voice/`.
- `electron/ipc/voice.ts`: IPC, shortcuts, tray items, links, the CLI method `keeper/voice`, and the abilities.
- `src/voice/`: the pill (`VoiceHud.tsx`), capture, sounds, palette commands and styles. The pages are `src/screens/Dictation.tsx` and `src/screens/Meetings.tsx`; the demo mock is `src/mock-voice.ts`.
- macOS native: `native/macos/KeeperHelper/Sources/keeper-helper/Voice.swift`, with one `voice.*` dispatch line in `main.swift`. It provides:
  - `voice.keys`: a listen-only event tap; right-hand modifiers are distinguished by device flag bits, fn by the secondary-fn flag;
  - `voice.systemAudio`: ScreenCaptureKit audio at 16 kHz mono, with Keeper's own sound excluded;
  - `voice.focus`: whether the focused field is secure (secure text field subrole or secure keyboard entry);
  - `voice.micState`: CoreAudio's "running somewhere" flag plus the running apps.
- Dictation was moved out of `electron/services/island.ts` and out of the Island's own `MediaRecorder`. The Island now only shows Voice's state. The old `island.transcribe` and `island.typeText` IPC calls are routed through Voice.

## How dictation works

1. The talk key or the shortcut starts a take. The app in front and its password-field state are read first. The pill window, which never takes focus, opens and starts recording at 16 kHz.
2. While you speak, the model re-reads the recent audio about every 0.9 s. Words that two passes agree on settle; the rest is shown lighter. Settled audio is dropped, so passes stay short however long the take is.
3. When you release the key (or press it again), the unsettled tail is recognised once more with your dictionary as a prompt. The text then goes through the tidy pipeline:
   - remove sound notes;
   - match snippets;
   - handle `literally` escapes;
   - carry out spoken commands (punctuation, symbols, pairs, structure);
   - `scratch that`;
   - remove fillers, stutters and false starts;
   - format numbers, times, money, dates, emails and links;
   - apply value corrections (`at 3 PM no wait 4 PM` gives "at 4 PM");
   - apply case commands (camel, snake, kebab, pascal, all caps);
   - turn emoji names into emoji;
   - apply the dictionary;
   - fix spacing, sentence case and unclosed brackets and quotes;
   - apply the tone (casual, neutral, professional, verbatim; exact mode for shells and code);
   - add paragraph breaks at long pauses and topic changes.
4. An optional polish pass runs only with an AI on this computer. If its reply changes too much, the rule-tidied text is kept.
5. Insertion: paste (the clipboard is restored), type the keys, or only copy. Text is never typed into an excluded app or a detected password field; the take is kept in history instead.
6. History records the app, the finished text, the raw text, and the recording if you choose to keep it. Correcting a take teaches the dictionary: a word corrected twice is suggested, and is never added without your yes.

**Edit by voice:** select text anywhere, press the edit shortcut and say an instruction. The selection is read by copying it, and the clipboard is restored. If the chosen AI is online, the pill asks first (*Allow once / Always allow / Cancel*). The result is pasted over the selection, so ⌘Z/Ctrl+Z undoes it.

## How meetings work

- **Capture:** the microphone (you) and the computer's sound (everyone else) are recorded as separate tracks:
  - macOS 13+ uses ScreenCaptureKit audio in the helper;
  - Windows uses WASAPI loopback through Electron's `audio: 'loopback'` in the pill window's own session;
  - Linux uses the default sink's `.monitor` through `parec` or `pw-record`.

  If the computer's sound can't be recorded, the meeting continues with the microphone only and says why.
- **Live transcript:** each track is cut at pauses (or at 25 s at its quietest point). Each piece is transcribed in a queue, and lines appear a moment after each pause. AIs can read them through `meeting_live_transcript` if you allow it.
- **Speakers:**
  - The microphone track is **You**.
  - The computer's sound is grouped into speakers on this computer by voice prints (MFCC mean and spread, standardised, then average-linkage cosine clustering). Those speakers are labelled **"Speaker 2", "Speaker 3"… as estimates**, or "Others" when only one group is found.
  - You can rename speakers; the calendar attendees are offered as names.
  - Microphone lines that repeat a loudspeaker line at the same time are dropped as echo.
- **Notes:** a summary, decisions and action items, written by:
  - *an AI on this computer* (default; plain rules when none is set up);
  - *my chosen AI* (only the transcript text is sent, never the sound);
  - *no AI*: rule-based extraction from the words people use for decisions and tasks.

  Notes can go to Keeper Notes (`<vault>/Meetings/<date> <title>.md`, with front matter: attendees, event, speakers) or to a folder. Action items can optionally become Reminders.
- **Your notes** (feature `meetingNotes`, on with Meetings; code in `core/voice/meeting-notes.ts`):
  - A notes pad sits beside the live transcript while recording, and on each recorded meeting (*Add your notes*). It is plain text: `## Heading` (or `Heading:`) starts a section, each other line is a point, `- [ ]`, `todo:` or `@name` makes an action item. Typing is saved as you go (`setMyNotes`), and kept with the meeting.
  - **Templates:** *Any meeting* (Notes, Decisions, Action items), *1:1*, *Standup* (Yesterday, Today, Blockers, Action items) and *Interview*, plus your own (Meetings → Settings → Note templates: a name, sections, and words in an event title). With *Template from the event* on, the calendar event's title picks one (whole words: "Daily standup" → Standup); your own templates are tried first.
  - **Tidy my notes** keeps every point in your words (marked *you*), adds the moment in the call each one matches (shared meaning words with a transcript line), fills a short point (five words or fewer) out with the sentence it was about, and fills the sections you left empty from the transcript: decisions, blockers and concerns, and action items said in the call that your notes don't already have. Everything taken from the transcript is marked *from the call*. With an AI (the *Notes written by* choice) the same is asked of it as JSON (`mergePrompt`); when it answers out of shape, plain rules do it. The Markdown note follows the template's sections, with transcript points in italics.
  - **Reminders:** *Add to Reminders* (or *Action items to Reminders* after every meeting) makes one reminder per action item with the meeting, event, owner and due words in its notes; writing the notes again keeps them linked and never adds one twice.
- **Calendar:** the event that overlaps the recording most (PIM calendars and the Island's calendar feed) is linked automatically, and can be changed on the page.
- **Exports:** Markdown, SRT, WebVTT (with `<v Speaker>` voice tags), plain text, JSON. A kept recording is saved as WAV.
- **Noticing calls:** a known meeting app using the microphone, a browser using the microphone with a meeting page open, or a browser on the microphone during a calendar event with a meeting link. The offer appears over the call, in a notification and in the tray, with a consent reminder. You can choose *Not now* (2 h) or *Never for this app*.

## Feature status

The ✅/🟡/❌ marks match the research files.

| # | Feature | macOS | Windows | Linux | Status |
|---|---|---|---|---|---|
| | **Dictation** | | | | |
| 1 | Hold to talk on fn and right-hand modifiers, F13–F19 | event tap (fn, right ⌥⌃⌘⇧) | `WH_KEYBOARD_LL` (no fn: Windows doesn't report it) | `/dev/input` (input group), else X11 raw key events (`xinput`); Wayland without either falls back to the shortcut toggle and says so | ✅ built |
| 2 | Tap to lock, press again to finish | ✓ | ✓ | ✓ | ✅ |
| 3 | Hands-free (start, then stop after a pause), time limit | ✓ | ✓ | ✓ | ✅ (no wake word) |
| 4 | Esc cancels and deletes the audio | hook | hook | hook or temporary global Esc | ✅ |
| 5 | Streaming live transcript | ✓ | ✓ | ✓ | ✅ on-device engine; each pass reuses the last one's work (see *Live text speed*) |
| 6 | Review step | ✓ | ✓ | ✓ | ✅ |
| 7–8 | Fillers, false starts, `scratch that`, `no wait` value corrections | ✓ | ✓ | ✓ | ✅ |
| 9 | Numbers, times, dates, money, emails, links | ✓ | ✓ | ✓ | ✅ English rules |
| 10 | Per-app tone and rules | ✓ | ✓ | ✓ (X11 front app) | ✅ |
| 11–13 | Paragraphs, auto-close pairs, emoji by name, `literally` | ✓ | ✓ | ✓ | ✅ |
| 14 | Spoken commands (punctuation, symbols, pairs, structure, case) | ✓ | ✓ | ✓ | ✅ about 70 phrases, English |
| 15 | Edit selection by voice, permission-gated | ✓ | ✓ | ✓ (xdotool) | ✅ better: any app |
| 16 | Fallback to the plain transcript | ✓ | ✓ | ✓ | ✅ (AI polish falls back) |
| 17 | Clipboard restored | ✓ | ✓ | ✓ | ✅ |
| 18 | Context reading of the field and window | — | — | — | 🟡 app name only; Keeper does not read field contents (privacy) |
| 19 | Prose and exact modes | ✓ | ✓ | ✓ | ✅ |
| 20 | Project file and symbol names from the repo | cwd of the front app's shells (`lsof`) | window title matched to known projects | cwd of the front app's shells (`/proc`), or the title | ✅ opt-in (*Spell my project's names*) |
| 22 | Dictionary plus learning from corrections, fed as a model prompt | ✓ | ✓ | ✓ | ✅ |
| 23 | Snippets (fuzzy trigger, exact text; the same list gives typed snippets their abbreviations, [LAUNCHER.md](LAUNCHER.md#typed-snippets)) | ✓ | ✓ | ✓ | ✅ |
| 24–25 | About 100 languages, automatic detection | ✓ | ✓ | ✓ | ✅ |
| 26 | Translation to English | ✓ | ✓ | ✓ | ✅ (Whisper translate task) |
| 27 | Engines and model manager | Whisper tiny/base/small/turbo, Apple recognizer, any OpenAI-compatible service | Whisper and service | Whisper and service | ✅ |
| 28 | HUD (pill in 6 positions, Island), sounds | ✓ | ✓ | ✓ | ✅ |
| 29 | History with search, app, raw text, kept audio, cap | ✓ | ✓ | ✓ | ✅ |
| 30 | Copy-only mode | ✓ | ✓ | ✓ | ✅ |
| 22b | Password-field guard | secure field / secure input | UIA `IsPassword` | AT-SPI role `PASSWORD_TEXT` where apps expose it; else the exclusion list | 🟡 on Linux |
| 23b | Per-app exclusions (kept in history) | ✓ | ✓ | ✓ | ✅ |
| 35 | URL scheme, CLI, palette, tray; Shortcuts actions | ✓ + Shortcuts actions | ✓ | ✓ | ✅ |
| 36 | Local statistics (words, time saved, active days, sparkline), PNG export | ✓ | ✓ | ✓ | ✅ |
| 37 | Microphone choice | ✓ | ✓ | ✓ | ✅ |
| 38 | Offline and private by default | ✓ | ✓ | ✓ | ✅ (changed from the cloud default) |
| | **Meetings** | | | | |
| 1 | Record microphone and computer sound, transcribe on device, pause and stop | ScreenCaptureKit (13+) | WASAPI loopback | monitor source | ✅ |
| 2 | Island and floating controls, tray | ✓ | ✓ | ✓ | ✅ |
| 3 | Any call app | ✓ | ✓ | ✓ | ✅ |
| 5 | Diarisation on device | ✓ | ✓ | ✓ | 🟡 honest: you vs others is exact; others are voice-print clusters labelled as estimates (no neural embedding model) |
| 6 | Names from the calendar and remembered voices | ✓ | ✓ | ✓ | ✅ suggested (always a suggestion, one click to accept) |
| 7 | Markdown note with decisions and actions first, front matter | ✓ | ✓ | ✓ | ✅ |
| 8 | AI choice including local | ✓ | ✓ | ✓ | ✅ (local is the default) |
| 10 | Live transcript for AIs (MCP/abilities) | ✓ | ✓ | ✓ | ✅ |
| 14 | Export | MD/SRT/VTT/TXT/JSON | | | ✅ better |
| — | Call detection with consent reminder | mic running + meeting app running (titles need Screen Recording, so not read) | registry mic use + window titles | `pactl` mic use + `wmctrl`/`xdotool` titles | ✅ |

Not built:
- the wake word;
- Siri phrases for the new actions (the shared `AppShortcutsProvider` in KeeperIntents is near Apple's 10-shortcut limit; the actions are listed in the Shortcuts app);
- reading field or window contents.

## Live text speed

The exported Whisper decoder has no key/value cache, so every new token re-reads the whole sequence. Live passes over one growing take now reuse the previous pass's work while the start of the kept audio is unchanged:
- **Draft verification:** the previous pass's tokens are checked in one decoder run. Keeper keeps the longest start that greedy decoding would produce anyway (the timestamp rules are applied per position), then decodes only what is new. The result is exactly the same text as decoding from scratch.
- **Mel reuse:** log-mel frames that only see audio already handled are copied, not recomputed.

The final pass on release reuses the same work.

Measured on this 4-core sandbox: whisper-tiny on an 11 s take, a pass every 0.9 s of speech, three alternating rounds, other agents running at the same time:

| Round | Before (ms per pass) | After (ms per pass) | Decoder before → after | Mel before → after |
|---|---|---|---|---|
| 1 | 945 | 516 (−45%) | 548 → 250 | 204 → 100 |
| 2 | 1423 | 1050 (−26%) | 951 → 546 | 207 → 110 |
| 3 | 1661 | 1220 (−27%) | 1069 → 647 | 202 → 121 |

The final text was identical in every run. The encoder (about 300–400 ms for tiny) is unchanged, because Whisper always reads a 30 s window.

## Code-aware spelling (opt-in)

With *Spell my project's names* on, when the app in front is an editor or a terminal, Keeper finds that window's git project in one of two ways:
- the working folders of the app's shell processes (`/proc` on Linux, `lsof` on macOS);
- a project folder named in the window title, among git folders under `~`, `~/code`, `~/src`, `~/projects` and similar (this is the only way on Windows).

It then reads the project's file names (`git ls-files`) and one `git grep` of declarations (`function`, `class`, `def`, `fn`, `struct`…), and caches them for 5 minutes.
- **Ranking:** names from files with uncommitted changes come first, then names from the last 15 commits, then the most frequent names.
- **Use:** the top 60 go before the personal dictionary in the recognizer's prompt. The tidy step also joins and fixes them, so "label speakers" becomes `labelSpeakers` and "key machine" becomes `KeyMachine`.
- **Privacy:** only names are read, never file contents, and they are kept only for the take.

## Speaker name suggestions

When you name a speaker (or accept a suggestion), Keeper stores that speaker's average voice print under the name, in `userData/voice/voices.json` on this computer. You can switch this off, and *Forget voices* removes them all.

In later meetings, each speaker told apart by voice is compared with the remembered voices, putting both on one footing with the meeting's own prints. People on the invite are preferred, and each name goes to one speaker only. With nobody remembered and exactly one other person on the invite, that person is suggested.

A suggestion shows as a dashed "Name?" chip with its reason, for example "Sounds like Ben Ortiz from earlier meetings, who is on the invite". It is never applied by itself.

## Shortcuts actions (macOS)

`native/macos/KeeperIntents/Sources/VoiceIntents.swift` adds three actions:
- *Dictate with Keeper* (start or stop, start, stop and type, cancel, edit the selection);
- *Record a Meeting with Keeper* (start, pause, resume, stop; optional title);
- *Get the Live Meeting Transcript*.

They use `keeper://dictation?do=…` and `keeper://meeting?do=…`, and `keeper meeting export --format txt`.

## Verified, and not verified

**Verified on Linux** (Xvfb, `test/e2e/voice.cjs`, 38 checks):
- the pages, tray items and palette;
- the tidy preview;
- the key hook's honest note when it can't listen (no `xinput` or input group here);
- a real take spoken through Chromium's fake microphone (a WAV file), with live words in the pill and the Island, recognised on device by whisper-tiny, tidied and placed on the clipboard;
- cancel;
- statistics, and *Save as picture* writing a PNG;
- the opt-in code-spelling and remembered-voices settings;
- a meeting recorded and transcribed live, with Island and tray activity, pause, stop, plain-rule notes and the transcript page;
- the computer-sound note when no sound server is running;
- the feature switch;
- no page errors;
- light and dark mode, and a small window with no sideways scrolling.

**Unit tests:** `test/voice-tidy.test.ts` and `test/voice-core.test.ts` (46 tests): pipeline, numbers, keys, Linux hook parsers, voice activity, streaming agreement, voice prints and clustering, echo removal, detection, exports, notes, history, settings, Whisper token tables/BPE, code-term ranking (including a real temporary git project), and voice-profile suggestions.

**Linux password-field guard** (`electron/services/voice/atspi.ts`, `test/voice-atspi.test.ts`, 5 tests): Keeper finds the accessibility bus (`org.a11y.Bus.GetAddress`), asks the registry for focus changes and remembers the focused object; when a take starts it asks that object's role, and `PASSWORD_TEXT` (40) keeps the text out of the field (it stays in history). Before any focus change is seen it looks under the active window (bounded: 600 objects, under a second). Verified against a private `dbus-daemon` where a stand-in desktop answers as AT-SPI does (the bus address, the registry, an app with a text field and a password field, focus signals). Where it cannot tell (no AT-SPI, or an app that does not expose its fields), the per-app exclusions remain the guard. Keeper does not switch the desktop's accessibility on for everyone: GTK apps expose their fields; Chromium/Electron apps and Qt apps often only when accessibility is on.

**Not verified** (no hardware or toolchain here):
- The Linux password guard with real at-spi2-core and real apps (this container has no at-spi2-core).
- Voice.swift is not compiled (no Swift toolchain in this environment). On real Macs, the following are untested: the event tap, ScreenCaptureKit audio, the secure-field check and the mic state.
- Windows: the PowerShell `WH_KEYBOARD_LL` hook, loopback capture, UIA `IsPassword` and SendInput typing.
- Linux: `/dev/input` with real keyboards, X11 `xinput` events, `parec`/`pw-record` capture, and `xdotool` paste and type.
- The large-v3-turbo model (pinned, 128 mel, v3 token table): unit-tested tokens only; not downloaded or run.
- Notes by an AI provider (only plain-rule notes were exercised).
- KeeperIntents' `VoiceIntents.swift` was not built (it needs Xcode).
- Finding the front window's project on a real desktop (no `xdotool` here). The git reading and ranking are tested.
- Name suggestions from real voices. They are tested with synthetic voices; the demo shows the chip.
