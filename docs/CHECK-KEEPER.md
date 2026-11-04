# Check Keeper and problem reports

When something seems wrong, Keeper can check itself and make a report you can attach to an e-mail or an issue. There is no telemetry: nothing is sent, ever, by either.

## Check Keeper

Settings → About → **Check Keeper** (or **Check Keeper** in the command palette) shows one row per part, green or amber:

| Row | Green | Amber, and its Fix |
|---|---|---|
| Saving | Keeper can save its settings and lists | Its data folder can't be written (full or read-only disk) · **Free up space** |
| Room on the disk | How much is free | Under 2 GB free · **Free up space** |
| Your library | How many files Keeper knows (or "Reading your folders now") | No files found in folders you chose · **Read them again** |
| Permissions | Everything the parts you use need is allowed | Which ones are not · **Allow** (Settings → Privacy & permissions) |
| Keeper's helpers | The Island, widgets and Mail processes that should run are running | Which one is not · **Start again** |
| Downloaded parts | The downloaded parts your features need are checked and ready | Which one needs downloading again · **Download** |
| Passwords | Kept in the system's keychain (or, with no keychain, until Keeper quits) | The keychain didn't open · **Try again** |
| Unexpected stops | None this week | How many this week · **Make a problem report** |

Each check has a time limit, so one slow answer never holds up the rest. **Check again** runs them all again.

## Make a problem report

Settings → About → **Make a report…**, the palette, or the button at the foot of Check Keeper. The sheet lists every file the report will hold, each one opened to show exactly what is inside:

- **about.txt**: Keeper's version, your system, what Check Keeper said, and which parts are on.
- **settings.json**: your settings, without keys, passwords, tokens, accounts or folders (the same rules as Export settings).
- **last-moments.json**: what Keeper did lately, its last 200 log lines and memory (`session/breadcrumbs.json`).
- **before-a-stop-….json**: the same notes from the last three times Keeper stopped unexpectedly, if it did.

Before anything is shown, Keeper takes out:

- your home folder (shown as `~`) and anyone else's (`/Users/<user>`);
- your user name and the computer's name;
- e-mail addresses;
- keys and tokens: `Bearer` and `Basic` values, API keys (`sk-…`, `ghp_…`, `AKIA…`), JWTs, bot tokens, `password=`, `token=`, `api_key=` and the like, and long secret-looking strings;
- IP addresses (not 127.0.0.1) and hardware addresses.

**Save report…** asks where to save `keeper-problem-report-<date>.zip` (Downloads to start with). Nothing is sent: attach it to an e-mail or a new issue (**New issue** opens one on GitHub).

## For developers

- `core/selfcheck.ts`: the rows from plain facts (`selfCheckRows`), the summary, `redact()` and the report's files. Unit tests in `test/selfcheck.test.ts`, including the redaction of each kind of secret and a check that ordinary log lines stay readable.
- `electron/services/selfcheck.ts`: gathers the facts (each with a time limit), runs a row's Fix, and saves the zip (JSZip).
- `src/components/SelfCheck.tsx`: the sheet.
- The real app on Linux (`test/e2e/attention.cjs`): the rows, the report's files, and a saved zip with no home folder in it.
- **Not verified here:** permissions on macOS and Windows, a locked keychain, and the save dialog on macOS and Windows.
