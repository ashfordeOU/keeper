# Quick Search as a launcher, typed snippets and the selection bar

Three parts that work from any app, each with its own switch in Settings → Features:

| Part | Switch | Starts | Costs while on |
|---|---|---|---|
| Apps and commands in Quick Search | `launcher` (on; needs `quickSearch`) | with Quick Search | nothing while Quick Search is closed; the list of apps is read when you search and kept for ten minutes |
| Typed snippets | `textSnippets` (off) | when on **and** at least one snippet has something to type | one key listener (below) |
| Actions for selected text | `selectionBar` (off) | its shortcut (⌘⇧1 / Ctrl+Shift+1) | nothing until the shortcut is pressed |

Clipboard sets and pasting one by one belong to Clipboard history (`clipboard`): see [ISLAND-TOOLS.md](ISLAND-TOOLS.md#clipboard-sets-and-pasting-one-by-one).

## Quick Search as a launcher

The rows above the files, best first (`topLaunchHits` in `core/search-everything.ts`):

| Row | What | Enter | Source |
|---|---|---|---|
| Answer | sums (`12*(3+4)`, `2^10`, `15% of 80`, `120 + 15%`, `sqrt 2`), unit conversions (`5 ft in cm`, `72f to c`) and, when turned on, currencies | copies the answer | `core/launcher/calc.ts` (its own parser; nothing is ever run as code), `core/island-tools/units.ts` (the Island converter) |
| Apps | apps on this computer, by name and keywords | opens it; ⌘/Ctrl/Alt+Enter shows it in its folder | `electron/services/launcher.ts` |
| Do | Keeper's own actions: screenshots, recording, keep awake, Stage, dictation, focus, locking folders, Wi-Fi and Bluetooth, the clipboard picker, pasting one by one, the selection bar | runs it | `core/launcher/actions.ts` (keeper:// links the app already answers, or a named job in main.ts) |
| Saved links | a word and an address with `{query}`: `map berlin` | opens the address with the words filled in (encoded) | Settings → General → Quick Search → Saved links |
| Your commands | a name, an optional word and a command line | runs it after asking (unless you said not to for that command); what it prints is shown, copied or ignored | Settings → General → Quick Search → Your commands (More settings) |

Ranking: every row has a text score (`scoreText`: word starts and the title count most) plus a bonus for what you opened before (`core/launcher/frecency.ts`): each use adds a point that halves every two weeks, and the bonus is at most 8, so a much better match still wins over habit. The uses are kept in `<userData>/launcher-uses.json` on this computer only.

Apps on each system:

- **macOS**: `.app` bundles in `~/Applications`, `/Applications` (and one folder deep), `/Applications/Utilities`, `/System/Applications` and `/System/Library/CoreServices/Applications`; opened with the system (`shell.openPath`), pictures from `app.getFileIcon`.
- **Windows**: Start menu shortcuts (`.lnk`, `.url`) of the user and of all users, without uninstallers and read-me links, and Store apps from `Get-StartApps` (opened through `shell:AppsFolder`).
- **Linux**: `.desktop` files in the XDG data folders, Flatpak's and Snap's exports, in the person's language, leaving out `NoDisplay`, `Hidden`, other desktops' and non-applications; opened with `gtk-launch` when present, otherwise the `Exec` line run directly (field codes dropped, quoting per the Desktop Entry rules, `Terminal=true` through `x-terminal-emulator`); pictures from the hicolor theme or `/usr/share/pixmaps`.

Your commands run in your home folder with the system's shell (`sh` or `cmd.exe`). `{query}` is replaced by what you typed after the command's word, quoted as one piece (`shellQuote`: single quotes on macOS and Linux; double quotes on Windows, where `%` and `!` are dropped because cmd.exe cannot quote them). Keeper shows the exact command line before each run, with "Don't ask again for this command". A run stops after 60 seconds.

Currency is off until Settings → General → Quick Search → Convert currencies is on; then the European Central Bank's daily reference rates are fetched (the Island converter's source, cached six hours). Until then, typing an amount of money says the conversion is off instead of downloading anything.

Saved links open only `http(s):`, `mailto:` and `keeper://` addresses.

## Typed snippets

Type an abbreviation (`;addr`, `/sig`, `brb`) in any app and it becomes its text. One list with Dictation's spoken snippets (`VoiceSettings.snippets`): a snippet has something to say (`trigger`), something to type (`abbr`), or both. The page is **Desktop → Typed Snippets**; Dictation → Words & snippets links to it.

- An abbreviation is 2–32 characters without spaces. One that starts with a letter or digit counts only at the start of a word (`brb` in `herbrb` is left alone); one that starts with a mark counts anywhere. The longest match wins (`findAbbreviation`).
- Placeholders (`renderSnippet`): `{date}`, `{date long|short|full|iso}`, date maths `{date +3d}`, `{date iso -1w}` (`min`, `h`, `d`, `w`, `m`, `y`), `{time}`, `{time 24h}`, `{weekday}`, `{clipboard}`, `{cursor}` (where the cursor ends up), `{snippet ;sig}` (another snippet, three deep at most), `{{` and `}}` for braces. Unknown placeholders stay as typed.
- Expanding: Keeper checks the app in front against the page's list (password managers by default) and Dictation's excluded apps, and asks whether the focused field is a password field (the same check as Dictation: macOS secure text fields, Windows UI Automation's IsPassword, Linux AT-SPI); then it presses Backspace once per character of the abbreviation, pastes the text (the clipboard is put back, and the paste stays out of clipboard history) and moves the cursor left to `{cursor}`. Its own keys are ignored by the listener for that moment.
- Import from CSV (More → Import from CSV…): abbreviation, text and (optionally) what to say; a first row of column names is skipped, and abbreviations already in the list are left alone.
- Export to CSV (More → Export to CSV…): the typed snippets as `abbreviation,text,say` (`snippetsToCsv`), which Import reads back. Said-only snippets stay in Dictation.
- Each expansion counts a use (`countUse`), shown on the page and used for its order.

### The page (`src/screens/TypedSnippets.tsx`)

- The head: the title, one line, a status pill (Listening / Not listening · Fix / Off; hidden until there is something to type), More, and **New snippet**, the one main button.
- The list is the page: each row has the abbreviation as a chip, the first line of the text (placeholders drawn as small chips) with the rest and what to say under it, and how often it was used. A floating capsule above it holds the search and the order (Most used, A to Z; `findSnippets`). Clicking a row opens it.
- New and changed snippets open in a sheet down the right edge: Type, Becomes with placeholder chips (Date, Time, Weekday, In a week, Clipboard, Cursor, put where the cursor is: `insertPlaceholder`), a live preview filled in by the main process (`snippets.preview`, so `{clipboard}` shows what was copied), and Or say when Dictation is on. Remove is in the sheet, with Undo in the toast.
- The pill opens a sheet that says whether it listens, the steps to fix it on this system (Open Input Monitoring on a Mac, Try again everywhere) and the privacy facts.
- More: Import from CSV…, Export to CSV…, Apps left out (n)… (a sheet; apps Dictation leaves out are skipped too).
- With no snippets the page shows a picture, one line and three starters (`STARTER_SNIPPETS`: `;date`, `;thx`, `;later`) added in one click, with Write your own and Import from CSV….
- Keys: N for a new snippet, / to search, ↑/↓ between rows, Enter to open, Delete to remove (with Undo), Esc to clear the search or close a sheet, Ctrl+Enter (⌘Enter) to save.

### The key listener (`electron/services/typing.ts`)

Listen-only on every system (each key still reaches the app in front); the last 64 characters are kept in memory to spot an abbreviation and dropped at Enter, Tab, Esc, the arrows, a click or a shortcut. Nothing is written anywhere. It runs only while typed snippets need it, or while a paste queue watches for ⌘V / Ctrl+V, and stops when neither does.

| System | How | Characters from | Limits |
|---|---|---|---|
| macOS | a listen-only event tap in keeper-helper (`voice.typed`), Input Monitoring permission | the keyboard layout in use (`CGEvent.keyboardGetUnicodeString`); dead keys wait for the next key | Secure Input (password fields, some terminals) hides keys from every app, so snippets do not expand there |
| Windows | a low-level keyboard hook and mouse hook (`WH_KEYBOARD_LL`, `WH_MOUSE_LL`) in a small PowerShell-hosted C# program | `ToUnicodeEx` with the foreground window's layout (flag 4, so dead keys are left alone) | injected keys (other programs' and Keeper's own) are ignored |
| Linux, X11 or the "input" group | the keyboard's `/dev/input` device when readable, otherwise `xinput test-xi2 --root` | the X server's own layout (`xmodmap -pke`), or a US layout without it (`LinuxKeyReader`) | a layout switched while it runs is noticed when it starts again |
| Linux, Wayland without the "input" group | not possible: Wayland keeps typing private to each app | — | the page says so and how to join the group |

## The selection bar (`electron/services/selection-bar.ts`, `src/selection/SelectionBar.tsx`)

Select text in any app and press the shortcut (Settings → General → Shortcuts; ⌘⇧1 / Ctrl+Shift+1 by default). A small bar opens beside the pointer with the actions that fit the text (`actionsFor`): Copy, Copy as plain text, Search, Translate, Rewrite, Shorter, Define (one to four words), Open link (a web address) and Write to (a mail address). Choose which ones in Settings → AI → Actions for selected text, with the language to translate into (the computer's by default) and the search address.

Reading the selection, in order:

1. Accessibility: macOS asks System Events for the focused element's `AXSelectedText` (Accessibility permission); Windows asks UI Automation's TextPattern for the selection.
2. Linux: the primary selection (`wl-paste --primary` on Wayland, `xclip` or `xsel` on X11), which is the selected text without copying it.
3. Otherwise a copy (⌘C / Ctrl+C), with the clipboard put back afterwards, as Dictation's "edit by voice" does.

Translate, Rewrite, Shorter and Define ask the AI chosen in Settings → AI (`brainSettings().active`), which may be Apple's on-device model, Ollama or another model on this computer; the bar says which AI answers and whether it is on this computer. Nothing is sent until a button is pressed. Results show in the bar with Copy and Replace (pasted over the selection in the app it came from). Keys: an action's first letter, Enter to replace, Esc to close.

## Platforms and what needs a real computer

- Linux (X11, Xvfb) is driven end to end by `test/e2e/launcher.cjs`: apps from `.desktop` files, opening one, ranking, saved links, actions, your commands, sums and conversions, the selection bar with a stand-in AI, and the Typed Snippets page (the first run with starters, the editor sheet, search, keys, remove with Undo, More, and a status pill that says plainly why it cannot listen in the test machine).
- macOS: the `voice.typed` event tap is new helper code, type-checked but not yet run on a Mac; app discovery and opening, `AXSelectedText` and Input Monitoring prompts need a real Mac.
- Windows: the typed-key hook, Start menu and Store app discovery and the UI Automation selection need a real Windows computer.
