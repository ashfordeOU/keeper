# Mail, calendars, reminders and the clock

Keeper by Ashforde® reads and writes your mail, shows and edits your
calendars, keeps your reminders and rings alarms and timers. Each of the three
parts is a feature you can switch off in **Settings → Features** (*Mail*,
*Calendar and reminders*, *Alarms, timers and world clocks*); when a part is
off, nothing connects, nothing is checked and nothing waits in the background.

## What works with what

| Service | Mail | Calendars | Reminders (tasks) | Contacts | How you connect |
| --- | --- | --- | --- | --- | --- |
| Any IMAP/SMTP provider | ✅ IMAP + SMTP | — | — | — | address + password; servers found automatically (provider file, autoconfig, DNS SRV, common names) or entered by hand |
| Gmail / Google Calendar | ✅ IMAP + SMTP (XOAUTH2) | ✅ CalDAV | ✅ CalDAV | ✅ CardDAV | **Sign in with Google** (needs a client ID, below) or an app password for mail |
| Outlook.com / Microsoft 365 | ✅ IMAP + SMTP (XOAUTH2) | ✅ Microsoft Graph | — | — | **Sign in with Microsoft** (needs a client ID, below) |
| iCloud | ✅ IMAP + SMTP | ✅ CalDAV | ✅ CalDAV | ✅ CardDAV | app-specific password |
| Fastmail | ✅ IMAP + SMTP | ✅ CalDAV | ✅ CalDAV | ✅ CardDAV | app password |
| Yahoo | ✅ IMAP + SMTP | ✅ CalDAV | — | — | app password |
| Proton Mail | ✅ through Proton Mail Bridge on this computer | — | — | — | the Bridge's password |
| Nextcloud, ownCloud, Radicale, Baïkal, Synology, any CalDAV/CardDAV server | — | ✅ | ✅ | ✅ | server address, user, password (self-signed certificates allowed when you tick the box) |
| A calendar link (.ics, webcal://) or file | — | ✅ read-only, fetched at most every 15 min | — | — | the address |
| **This computer's calendars** (macOS Calendar, Windows Calendar or Outlook, GNOME/Evolution, KOrganizer) | — | ✅ on by default, read live (see below) | — | — | allow calendar access once |
| Holidays, birthdays | — | ✅ worked out here | — | — | pick a country; birthdays come from contacts |
| This computer only | — | ✅ "On this computer" | ✅ "Reminders" | ✅ | nothing to set up |

JMAP is not used yet; Fastmail works through IMAP and CalDAV with an app password.

## Mail

- **All inboxes together** or one folder at a time; **conversations** (by
  Message-ID / In-Reply-To / References, with a subject fallback) or single
  messages; filters for unread, flagged and attachments; search with words and
  `from:`, `to:`, `subject:`, `is:unread`, `is:flagged`, `has:attachment`
  (Keeper's list) and the server's own search for older mail.
- **Push, not polling**: each inbox keeps one connection in IMAP IDLE, so the
  server says when mail arrives. A safety check every 10 minutes (slower when
  you are away, never while the screen is locked) covers servers without IDLE.
  The connection for reading and filing opens when needed and closes after a
  minute of quiet.
- **Safe reading**: the message is cleaned (no scripts, event handlers, forms,
  frames or SVG; links show their real address and open in your browser) and
  drawn in a sandboxed frame with no scripts and a strict Content Security
  Policy. **Pictures and styles from the internet are held back** until you
  press *Show pictures* (or *Always from this sender*); **tracking pixels** are
  removed. Plain-text mail follows Keeper's theme.
- **Writing**: To/Cc/Bcc with suggestions from your contacts and people you
  wrote to; several accounts and identities; **Markdown** (bold, lists, links)
  sent as a proper HTML part with a plain-text part; attachments by button or by
  dropping files (also from Browse); signatures; quoted text you can show or
  hide. **Send later** (tomorrow morning, afternoon, Monday) and **Undo send**
  (5–30 seconds, Settings). A copy goes to Sent (Gmail files its own).
- Reply, Reply All (without you) and Forward; flag, read/unread, archive, junk,
  delete (to Trash), move by dragging onto a folder, **snooze** (hidden until
  then, comes back unread at the top with a note in the Island; the *Snoozed*
  view lists what is waiting), **unsubscribe** (one-click when the list offers
  it, otherwise by mail or the list's page), save or open attachments.
- **Important and Other** (`core/pim/triage.ts`): people you have written to
  or keep as contacts, replies to your own mail, flagged mail and mail written
  to you by a person are Important; mailing lists (List-Id, List-Unsubscribe,
  Precedence: bulk, Auto-Submitted), and machine senders (no-reply, news,
  orders…) are Other. **Security mail** (sign-in alerts, one-time codes,
  password resets, in several languages) is always Important and marked. A
  sender can be pinned to either side from the message's menu.
- **Waiting for reply**: conversations whose newest message is yours, written
  to a person, from the last six weeks (Inbox, Sent and Archive of every
  account, copies counted once), with *Follow up* (a reply-all to your own
  message, ready to send) and *Done*.
- **Subscriptions**: lists and newsletters grouped by List-Id or sender, with
  how many arrived and how many were opened; *Unsubscribe & archive*, *Archive
  all*, *Unsubscribe*, *Delete all*. Their later mail goes to Other.
- **Views across accounts**: All inboxes, All sent, Snoozed, Scheduled (Send
  later), Waiting for reply, Subscriptions.
- **Search**: every folder kept on this computer first (inboxes first), then
  the servers' own search for older mail (Inbox, Sent, Archive / All Mail),
  shown in a section of its own. A question (ending in `?`, or *Ask*) is
  answered by the AI from the best-matching messages, with links to them.
- **Offline**: lists, Sent, Archive and the newest 30 inbox messages' text are
  kept on this computer. Read, flag, archive, delete and move work offline;
  the change is queued and sent when the server answers again.
- **Layouts**: *Split* (folders, list, message) or *Wide list* (one line per
  message with columns, bulk actions always shown, the message opens in place
  of the list).
- **Invitations**: meeting requests show a card with *Accept / Maybe / Decline*;
  Keeper sends the answer to the organiser (iTIP REPLY) and puts the event in
  your calendar.
- **AI** (optional, with the AI chosen in Settings → AI & Brain, which can be
  on this computer only): *Summarize* a conversation, *Reply ideas* (three
  answers, yes / ask / not now, in your own voice taken from lines of your sent
  mail), *Translate* into the interface language, *Find dates* (turns them
  into events you can add), *Rewrite* in the compose window (shorter,
  friendlier, more formal, proofread, translate; on the selection or all, with
  Undo) and *Ask* across your mail. Keys, passwords and card numbers are
  blanked before anything goes to an AI on the internet; security mail is
  never sent at all.
- Keyboard (`core/pim/shortcuts.ts`), three sets: *web mail* (`j`/`k`, `r`,
  `a`, `f`, `e` archive, `#` delete, `s` flag, `b` snooze, `x` select, `g i` /
  `g o` Important / Other, `⇧F` follow up), *desktop mail* (↑/↓, `⌘R`, `⌘⇧R`,
  `⌘⇧F`, `⌘N`, `⌫`), and *fast triage* (`e` done, `h` snooze, `u` toggle
  read, Tab / ⇧Tab between Important and Other). Every key can be changed in
  Settings → Mail & Calendar. `⌘↩`/`Ctrl+↩` sends.
- Notifications for new mail, with *no previews* if you prefer (only "New
  mail" is shown). New **Important** mail drops down from the Island (the
  notch or the pill) with *Open*, *Archive* and *Mark read*; Settings can
  include all mail or none.

### Mail: reading, sorting and writing (second round)

- **Tabs**: All, Primary (the same as Important), Updates and Promos (Other,
  split by what the mail is: receipts, notifications and accounts, or
  marketing), each with its unread count, and an *Unread* toggle
  (`core/pim/smart.ts`). **To Reply** lists mail from people waiting for your
  answer (written to you, not a list or a machine, the last word theirs).
- **Accounts**: `⌘1`…`⌘9` (Ctrl elsewhere) open one account's inbox, `⌘0`
  all of them. Each account has a colour, an optional picture, its unread
  count, a reading view (*Classic* or *Chat*: bubbles with a reply box), and
  whether its mail drops from the notch. **Send-from addresses** (aliases)
  each have their own signature and Reply-To; replies go from the address the
  mail was written to. Signatures can be left off replies per account and
  taken off one message in the compose window.
- **Setup guides** for Gmail, Outlook, iCloud, Yahoo, AOL, Fastmail, Zoho and
  any IMAP provider in the Add account dialog, linking to each provider's
  app-password page (`core/pim/provider-guides.ts`).
- **Search** (`⌘K`): `from:` `to:` `subject:` `has:attachment` `is:unread`
  `is:read` `is:flagged` `in:` (inbox, sent, a folder, important, updates,
  promos) `label:` `account:` `before:` `after:` (dates or `7d`, `2w`, `3m`,
  `1y`), quoted phrases and `-word`. This computer's results first, then the
  servers' older ones (the same filters as an IMAP SEARCH), newest first.
  `pim.search(query, { server })` is the one function other pages call
  (`core/pim/search.ts`). A search can be kept as a **smart mailbox**.
- **Rules** (`core/pim/rules.ts`): conditions on the sender, recipients,
  subject, text, attachments and mailing list (all or any), actions move,
  archive, mark read, flag, label and delete, run on this computer as mail
  arrives. Rules marked *Also on the server* are written as a **Sieve** script
  through **ManageSieve** (RFC 5804, port 4190, STARTTLS required, own small
  client: `electron/services/pim/managesieve.ts`) or as **Gmail filters**
  (Gmail API, signed in with Google). Rules that cannot be written there keep
  running in Keeper.
- **Mute** a conversation (new mail in it is read and archived) and **block** a
  sender or a domain (their mail goes to Junk, also what is already there).
- **Remind me if no reply** on sent mail: in a day, three days, a week or on a
  date, from the message or while writing; the Island and a notification say
  so if nobody answered.
- **Invitations**: *Accept / Maybe / Decline* answer the organiser (iMIP
  REPLY) and say plainly when the account cannot send; *Add to Calendar* adds
  the event without answering.
- **Reading**: sender pictures from your contacts (pictures inside the
  contact card only; nothing is fetched), a known company's colour, or
  initials. Designed mail stays on a light card in dark mode (or is darkened,
  if chosen). Text size with `⌘+` / `⌘−`; list density. **Quick Look** for
  pictures, PDFs and text attachments. **Print** and **Save as PDF**.
- **Phishing warnings** (`core/pim/phishing.ts`): a contact's name on a
  stranger's address, a company's name on another domain, look-alike domains
  (one letter off, letters from other alphabets, `paypal-security.example`),
  replies that go elsewhere, link text naming another place, and failed
  DMARC. A banner offers *Report spam* (to Junk, sender blocked) and *Block*.
  Such mail never gets a one-click *Copy code* or *Open link*.
- **Privacy**: pictures from the internet are held back by default (*Load
  images*, `⇧⌘I`, or always for a sender), tracking pixels are removed and
  tracking parameters (`utm_*`, `fbclid`, `mc_eid` …) are taken off links
  (`core/pim/privacy.ts`). Keeper never sends read receipts. Settings → Mail &
  Calendar → Mail privacy lists every connection Mail makes.
- **Sign-in codes and links**: a new sign-in code gets *Copy code* in the
  notification and *Copy* in the Island; a magic sign-in link gets *Open link*.
- **Writing**: rich text (bold, italic, underline, lists, sizes, links;
  Markdown typed as text still works), templates with `{first_name}` and
  friends, drafts kept with the window and **saved to the server's Drafts**
  (one copy, replaced as you write, removed when sent), `⌘J` for tones
  (shorter, more detail, friendlier, more formal, confident, casual,
  apologetic, proofread) or your own instruction, **streamed into the
  message**, with **what the AI remembers** about you (a list you see and edit
  in Settings; "remember that …" adds a line). *Ask* answers cite the messages
  as numbered links.
- **Undo**: `⌘Z` takes back the last archive, delete or move (the messages are
  found again by Message-ID). Undo send is off or 5–30 seconds; the Island
  counts down with *Undo*.
- **Snooze on every computer**: a snoozed message carries an IMAP keyword
  (`$KSnooze-<time>`); servers without keywords get a small note in a hidden
  *Keeper Snoozes* folder (`core/pim/snooze-sync.ts`).
- **Catching up** after sleep, unlocking or a network change: inboxes, the
  offline queue, the outbox and no-reply reminders are checked at once.
- **Dock badge**: all unread, Important only, or none.
- **The notch**: which accounts and which senders drop down; dropping files
  on the notch puts them on the shelf, whose *Email* button starts a message
  with them attached.
- **Widgets**: Unread mail, Inbox (Important, medium and large) and Mail
  accounts (small and medium).
- **AI apps over MCP**: *Add to* Claude desktop, Claude Code, Cursor or Codex
  writes their settings file after you confirm (the old file is kept as a
  backup). Besides search, read and drafts, apps may **tidy** (archive, label,
  move; never delete), each batch approved by you in Keeper, and **prepare** a
  message, which opens in Keeper's compose window and goes only when you press
  Send.

### An iPhone companion (not built)

What a companion app would need: the accounts list without passwords (the
phone signs in itself, or receives an app password over the paired Keeper
link), the snooze keywords and the *Keeper Snoozes* note (already on the
server, so a phone app can read them), rules on the server (Sieve or Gmail
filters, already written), push for new mail (an APNs relay, since a phone
cannot hold IMAP IDLE in the background), and the AI memory and templates
synced through Keeper's device link. Nothing on the Mac side blocks it.

## Where calendars come from

**Settings → Mail & Calendar → Calendar** (also *Add or connect calendars* on
the Calendar page) lists every source; each calendar can be shown or hidden,
given a colour (kept when the source syncs) and switched on or off for the
**Island**.

- **This computer's calendars, by default.** Keeper reads the calendars your
  system already has, so the accounts you added there (iCloud, Google,
  Exchange, Microsoft 365, CalDAV, subscriptions) appear without signing in
  again. A copy is kept on disk, so the views work offline.
  - **macOS:** EventKit through keeper-helper (`calendar.access`,
    `calendar.events`, `calendar.save`, `calendar.delete`). macOS asks once
    (*Allow calendar access* in the Island's Calendar tab, the Calendar page or
    Settings; when it was refused, *Open System Settings* goes to Privacy &
    Security → Calendars). Changes made in Calendar arrive by themselves: the
    helper streams `calendar.watch` (EKEventStoreChanged) and Keeper reads
    again within a second. New events and changes from Keeper (quick add, the
    editor, drag to move) are written to the Mac's calendars; a repeating
    event is changed one occurrence at a time.
  - **Windows:** the AppointmentStore (Windows Calendar and the accounts in
    it, Outlook) through a small PowerShell helper. Windows usually gives this
    store only to apps installed from a package; Keeper is not, so on most
    computers it falls back to **Outlook's own calendar while Outlook is open**
    (it is not started for you) and says so in Settings. Read only. Connecting
    Microsoft 365, Outlook.com or Google directly (below) works everywhere.
  - **Linux:** Evolution Data Server over D-Bus — the calendars of GNOME
    Calendar and Evolution, including Google and Microsoft accounts added in
    GNOME Online Accounts — read and written. Without it, Evolution's local
    calendar files, KOrganizer's files and Akonadi iCal-file resources are read
    (read only). Other Akonadi resources (KDE's Google or Exchange accounts)
    are not read; connect those accounts directly.
- **Connect an account directly:** *Google Calendar* and *Microsoft 365 /
  Outlook* sign in for the calendar only (no mail access is asked for; Google
  through CalDAV, Microsoft through Graph); *iCloud, Fastmail, Nextcloud,
  CalDAV…* with an app password. Passwords and tokens go to the keychain.
- **Subscribe** to a calendar link (`https://`, `webcal://`, or a file path).
  The Island's old *Calendar link* setting is added here as a subscription the
  first time Keeper starts (and whenever it is changed).
- **Import** an `.ics` file: *Import .ics*, the command palette's *Import
  Calendar File…*, or drop it on the Calendar page, the Island's Calendar tab
  or the Island's shelf. Events go into the default calendar.
- **Holidays:** nationwide public holidays of a country (United States,
  United Kingdom, Ireland, Canada, Australia, New Zealand, Germany, Austria,
  Switzerland, France, Spain, Italy, the Netherlands, Belgium, Sweden,
  Estonia, Poland, India), including weekend days moved to a weekday. Chosen
  from the system's region the first time; regional holidays are not included.
- **Birthdays:** from the birthdays in your contacts (29 February falls on the
  28th in other years).

### Keeping up to date

The governor checks calendars every **5 minutes**, every **minute** while a
calendar is on screen (the Island's Calendar tab or the Calendar page), and
never while the screen is locked. Servers answer "nothing new" cheaply (ctag,
sync token); subscribed links are fetched at most every 15 minutes. On a Mac
the system says when its calendars change, so they are read then (and
otherwise only every 15 minutes).

## The Island

- The next timed event within 15 minutes shows in the notch as a
  **countdown** in the calendar's colour; opening it shows *Join* for a
  meeting link (Zoom, Google Meet, Teams, Webex, Jitsi, Whereby — found in the
  event's address, place or notes) and *Record*.
- The **Calendar tab** shows today and tomorrow (or any day picked in the
  month), with quick add into a chosen calendar. Clicking an event opens it in
  macOS Calendar, on the provider's page, or in Keeper's calendar.
- Calendars with *Island* off stay out of both; the same meeting from two
  calendars shows once. *Settings → Features → Next meeting* switches the
  countdown off.

## Calendar

- **Day, week, month, agenda and year** views; colours per calendar; show or
  hide calendars; week numbers (Settings); weeks starting Monday, Sunday or
  Saturday.
- **Quick add in plain English**: "Lunch with Ana Friday 1pm at Café Sol",
  "Dentist tomorrow 15:30 for 45 min", "Standup every weekday 9:15", "Trip to
  Lisbon 12–15 March", "Call mum in 2 hours remind me 10 min before". Runs on
  this computer.
- **Drag** events to move them (also to another day) and drag the bottom edge
  to change the length; double-click empty space for a new event.
- The editor: all-day, start and end, **repeats** (daily, weekdays, weekly,
  every two weeks, monthly, yearly, and any rule from other apps shown in words),
  alerts, place, people, notes, calendar. For a repeating event you choose
  **this event** or **all events in the series**; one changed occurrence is
  stored the standard way (RECURRENCE-ID), a removed one as an exception.
- Repeats are expanded on the wall clock of the event's **time zone**, so 9:00
  stays 9:00 across daylight-saving changes; Windows zone names from Exchange
  invitations are understood.
- **CalDAV sync** downloads only what changed (sync tokens, ETags), writes with
  version checks so nothing changed elsewhere is overwritten, and checks every
  15 minutes (less when you are away, never while locked).
- **Meeting links** (Zoom, Google Meet, Teams, Webex, Jitsi, Whereby…) get a
  *Join* button; your next meeting shows in the **Island** with a countdown.
- Import and export `.ics`; subscribe to calendar links (see *Where calendars
  come from*).

## Reminders

A local *Reminders* list and the task lists of your CalDAV accounts (VTODO):
due dates ("Call the bank tomorrow 10am" sets the time), priorities, notes,
*Today* and *Important* views; due reminders ring like alerts.

## Clock: alarms, timers, stopwatch, world clocks

- **Alarms** once or on chosen days, with a label, a sound (made on the
  computer, no files), snooze length. They ring in Keeper (a window with
  *Snooze* and *Stop*), as a notification and in the Island.
- **Timers**: several at once, pause, restart; running timers show in the
  Island.
- **Stopwatch** with laps; **world clocks** for any time zone.
- **Sleep**: a computer that is asleep cannot ring. When it wakes, an alarm or
  alert missed by up to 15 minutes rings late (once); older ones are skipped.
  On a Mac, *Wake the computer* schedules a wake-up with `pmset` (asks for an
  administrator once). Windows (Task Scheduler "wake to run") and Linux
  (`rtcwake`) need administrator rights and are not set up by Keeper yet.

## Privacy and storage

- Mail and events stay on your providers' servers and in Keeper's data folder
  (`pim/` inside it): lists of messages, message bodies you opened (for
  offline reading), calendars and reminders as small JSON files.
- **Passwords and sign-in tokens go to the system keychain** (Keychain, Windows
  Credential Manager via DPAPI, Secret Service/KWallet). On a Linux desktop
  without a keychain they are kept only until Keeper quits — never written in
  plain text — and Keeper asks again next time.
- Keeper sends nothing anywhere else. AI help is used only when you press it.

## Google and Microsoft sign-in: client IDs

OAuth sign-in needs an app registration with each provider. A build has them
only when its release secrets `KEEPER_GOOGLE_CLIENT_ID` (with
`KEEPER_GOOGLE_CLIENT_SECRET`) and `KEEPER_MS_CLIENT_ID` were set; when a
provider's ID is missing, its *Sign in* button is hidden. Gmail, iCloud, Yahoo,
AOL, Fastmail and Zoho then work with an app password (the account dialog links
to the page that makes one). Outlook.com and Microsoft 365 no longer accept
passwords from mail apps, so they need the Microsoft sign-in. To register:

- **Google**: Google Cloud Console → APIs & Services → enable *Gmail API*,
  *CalDAV API* and *People/CardDAV*; OAuth consent screen with scopes
  `https://mail.google.com/`, `.../auth/calendar`, `.../auth/carddav`; create an
  OAuth client of type **Desktop app**. Its client secret is not confidential
  for desktop apps. Full Gmail access is a "restricted" scope: Google requires a
  security assessment before the app can be used by everyone.
- **Microsoft**: Microsoft Entra admin center → App registrations → new
  registration for "Accounts in any organizational directory and personal
  Microsoft accounts"; platform **Mobile and desktop applications** with
  redirect URI `http://localhost`; delegated permissions `IMAP.AccessAsUser.All`,
  `SMTP.Send`, `offline_access` (Outlook) and `Calendars.ReadWrite`,
  `Contacts.Read` (Microsoft Graph). No client secret.

Give the IDs to the build as `KEEPER_GOOGLE_CLIENT_ID`,
`KEEPER_GOOGLE_CLIENT_SECRET` and `KEEPER_MS_CLIENT_ID` (compiled in by
`scripts/build-main.mjs` from the build environment; the release workflow passes
the repository secrets of the same names), set them in the environment at run
time, or paste them in **Settings → Mail & Calendar → Developer options:
sign-in client IDs**. Keeper uses the authorization-code flow with PKCE and a one-time
address on `127.0.0.1` (RFC 8252); the answer's `state` must match.

## For agents and the keeper command

`electron/services/pim/brain-adapter.ts` offers `searchMail`, `listEvents`,
`previewEvent` and `createEvent` to the agents layer, and the local socket
answers `keeper/mail.search`, `keeper/calendar.list` and
`keeper/calendar.add`. Spam, Trash and security mail are left out.

**MCP mail tools** (`core/pim/mail-mcp.ts`, registered by
`electron/ipc/pim.ts`): `mail_search`, `mail_read`, `mail_thread` and
`mail_draft`, only for accounts switched on under *Share with coding
assistants* (off by default). There is no tool to send, delete or move; a draft
is written into the account's Drafts folder for you to send. Spam and Trash
(by special use or usual name) and security mail (sign-in alerts, one-time
codes, password resets) are never returned, and secrets and codes are blanked
in what is.

## What was tested, and what was not

Tested here (Linux):

- Mail sorting and safety (`test/mail-triage.test.ts`): Important / Other and
  security alerts, sign-in code detection and blanking, Waiting for reply
  across folders and copies, follow-up drafts, subscription statistics,
  snooze and send-later times, the undo-send window, offline errors, local
  then server search, the shortcut sets and two-key sequences, and the MCP
  tools' limits (no send/delete/move, no Spam, Trash, security mail or
  unshared accounts, secrets blanked, drafts only). Against Dovecot: List-Id /
  List-Unsubscribe / Precedence read at sync, server search summaries.

- Unit tests (`test/pim.test.ts`): time zones and daylight saving, repeat
  rules (weekly with intervals, "last Friday", BYSETPOS, UNTIL, skipped month
  days), iCalendar reading and writing (folding, exceptions, changed
  occurrences, alarms, tasks, Windows zones), invitations (REQUEST, REPLY),
  CalDAV answers, autoconfig files, the HTML cleaner (scripts, handlers,
  forms, frames, remote pictures and CSS, tracking pixels, links),
  conversations, replies, addresses, unsubscribe headers, filters, search,
  quick add, alarm scheduling across sleep, OAuth PKCE, XOAUTH2, vCards, and
  timers in the Island.
- Against real servers (`test/pim-servers.test.ts`): **Dovecot** IMAP
  (folders and special folders, sync with previews, MIME with
  quoted-printable, RFC 2047 file names and attachments, flags, server search,
  **IDLE push**, move, delete to Trash, wrong password), an **SMTP** server
  (authentication, threading headers, Markdown HTML, attachments, Bcc not
  written in the message), a **CalDAV** server (discovery, colours, task
  lists, sync tokens, conditional writes, a changed occurrence stored with
  RECURRENCE-ID, deletions, tasks), and the **OAuth loopback flow** with a
  simulated browser (and a forged `state` refused).
- Calendar sources (`test/calendar-sources.test.ts`): mapping EventKit,
  Windows and Evolution answers (fixtures), calendar files, colours, joining
  with Keeper's list, holidays (Easter, observed days) and birthdays, meeting
  links, the Island's agenda and countdown, quick add, and `.ics` edge cases
  (repeats across daylight saving, exceptions, all-day spans, Windows zones,
  floating times, folded text, file subscriptions).
- The real app (`test/e2e/calendar.cjs`): an imported file, a subscribed link
  and the old Island link reach the Island's agenda and countdown with *Join*;
  quick add (in Calendar and in the Island) writes to a CalDAV server; *Island*
  off hides a calendar; the Calendar page and its sources in light and dark.
- The real app (`test/e2e/pim.cjs`, 20 checks): adding a mail account through
  the dialog, reading a message with its picture held back and the tracking
  pixel removed in a sandboxed frame, replying with Markdown, Undo send, the
  reply reaching the SMTP server threaded and landing in Sent; a CalDAV
  account, a repeating event written to the server, one occurrence changed;
  an event alert reaching the Island at its time; a timer ringing with Snooze
  and Stop; switching Mail off removes it from the sidebar.

Not tested:

- Real Google, Microsoft, iCloud, Fastmail and Yahoo accounts (they need real
  accounts and, for Google/Microsoft, registered client IDs). Microsoft Graph
  calendars are written from Microsoft's documentation and have not talked to
  Microsoft.
- macOS and Windows: notifications, the Mac wake-up, keychain storage on those
  systems.
- The computer's own calendars: the macOS EventKit code (Swift) and the
  Windows PowerShell helper were written without a Mac or Windows computer
  and have not run; the Mac test kit's *Calendar* area checks the Mac side
  (access, calendars, change notices, writing one test event). On Linux the
  Evolution client is tested against a stand-in Evolution service on a private
  D-Bus (`test/calendar-eds.test.ts`), not against a real GNOME desktop.

Not built yet: JMAP; adding message text to Keeper's brain for the Assistant
; a contacts page (contacts
are read from CardDAV and used for suggestions only); an *Attachments* shelf in
the Library; Windows and Linux wake-ups for alarms.
