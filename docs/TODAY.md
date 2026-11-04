# Today, the Inbox and Plan my day

Keeper used to have four "todays": a Today column on Hello, Mail's Today
strip, the Planner's Today view and the Island's next event. Now there is one
place that answers "what now?": **Today, at the top of Hello**.

## Why Today lives inside Hello

Hello is Keeper's start page (the first row in the sidebar). Today is its top
section, not a page of its own:

- One front door. Keeper opens on Hello, so Today is the first thing you see
  without another sidebar row or a choice between two start pages.
- One greeting. "Good morning" belongs to Hello; Mail no longer greets you a
  second time once you have seen Today.
- Files stay one scroll away. Your folders, Jump back in and Find a file
  follow under Today, so Hello is still the front door to your files.
- It can still go. **More (…) → Hide Today**, or Edit Home, hides it;
  Edit Home can also move it down.

Older Home layouts move on by themselves (`migrateHomeV4` in
`core/home-layout.ts`): Today moves to the top and everything else keeps its
order. A hidden Today stays hidden.

## The cards

Each card comes from one list (`TODAY_CARDS` in `core/today.ts`) and has an
owner part; a card whose part is off is not shown.

| Card | What it shows | Part |
| --- | --- | --- |
| Now and next | The event going on (a call with a video link first) with time left and **Join**, then the next one; all-day events as chips; the block you planned, with a tick box | Calendar and reminders |
| Top three | Today's three most important tasks (priority first, then your order), with tick boxes. Carried-over tasks count | Calendar and reminders |
| To reply | How many messages wait for your answer (Mail's To Reply) | Mail |
| Inbox | How much is in the Inbox and how long sorting takes | Inbox |
| One thing to fix | The most useful item from the Fix-it List, with its fix and Not now / Trust | Fix-it list |
| Focus | 25 minutes on your top task, or the session going on with Stop | Focus timer |
| Follow-ups (quiet) | How many messages you sent wait for an answer past your follow-up days (Settings → Mail), opening Mail's Waiting | Mail |
| Backups (quiet) | A backup that went wrong, or is late for its schedule ("Last backup 3 days ago"), with **Fix** | Sync & Backup |
| Your week | Tasks done, focus time and your streak this week, from what used to be the separate Insights | Insights |
| On this day (quiet) | Up to four pictures made on this day in earlier years ("A year ago") | Library |

A **quiet** card takes no room until it has something to say: a calm day shows no Backups or Follow-ups card at all. The usual set includes Follow-ups and Backups; **Your week** and **On this day** are in the full set and in Edit Home → Today's cards.

With nothing on the calendar, **Now and next** shows a small designed empty state, *A clear day*, with **Add an event**.

Which cards show follows the preset until you pick your own (Edit Home →
Today's cards): **Light** and **Files only** get a calm three (Now, Top three,
Focus); **Recommended** gets five (no Focus) plus the quiet Follow-ups and Backups; **Everything** gets every card. When
the modes arrive they will choose a set the same way (`sizeForPreset`).

Timers, Keep Awake and a recording show as small capsules under the cards
while they run. **Plan my day** is Today's one strong button in the morning;
once a plan exists it steps into More, and late in the day **Wrap up the day**
takes its place.

**More (…) → Today's note** opens today's daily note in Notes, made from your daily note template the first time.

While Today shows its own Fix-it card, Hello's separate suggestion line steps
aside, so the same item never shows twice.

Nothing polls: events, tasks, mail and the Inbox follow their change events;
the clock moves twice a minute.

## Mail's Today strip

Once Today has been on screen for a few seconds on a day (`today.seen` in the
settings), Mail's Today strip shrinks to one line for the rest of that day:
what is on now or next, and a **Today** button back to Hello (Join stays in
the meeting chip at the top of the window). There is no second greeting. Settings → Mail & Calendar → *Show today at the top of
the inbox* still turns it off altogether.

## The Inbox

One shortcut from any app (**Ctrl Alt J**, **⌘⌥J** on a Mac; Settings →
General → Shortcuts → *Inbox shortcut*) opens a small card in front of
everything. Type or dictate a thought, paste a link, take a screenshot of an
area, or drop a file, then press Enter. It lands in the Inbox with the time.
Esc closes the card. The card is also in the menu-bar or tray menu (*Catch
Something…*), the command palette and `keeper://inbox`.

The **Inbox page** (from Today's Inbox card or the palette) shows one item at a
time, big, with five choices on the keys 1 to 5:

1. **Task**: the first line is the title, read in plain words ("call Ana
   friday 3pm"); the rest goes in its notes, a link in its link.
2. **Note**: one line in today's daily note in your first notes folder, with
   the time.
3. **Event**: Calendar's plain words make the event ("Lunch with Ana friday
   1pm"); without a day or time, Keeper says so and the item stays.
4. **Snippet**: asks for the abbreviation (a free one is suggested) and adds a
   typed snippet.
5. **Delete**.

Every choice has **Undo** (it removes what was made and puts the item back).
← and → move between items. A choice whose part is off is greyed out with the
reason. The Inbox is one file on this computer (`inbox.json` in Keeper's data
folder), at most 500 items; nothing leaves the computer.

## Plan my day

A two-minute ritual in three steps:

1. **Pick** up to three tasks: today's first three are picked to start with;
   the Inbox's tasks are offered too, and a new one can be added.
2. **How long**: 15, 30, 45, 60 or 90 minutes each (a guess from the task's
   steps to start with).
3. **Your day**: Keeper lays them into the free time between your events,
   from now (or the start of your working day) to its end, with a five-minute
   breath between blocks. Move a block 15 minutes earlier or later; it never
   runs into an event, another block or past the end of the day. Anything that
   does not fit is named and stays on your list.

**Add to calendar** writes each block as an ordinary event in the calendar you
choose (Keeper's own calendar on this computer by default), and the planned
tasks become today's. Each block's link is `keeper://task/<id>`, so:

- the Now card shows the block going on with a tick box that ticks the task;
- the Island counts the block down like any event;
- opening the block's link opens its task in the Planner.

The working day is 9:00 to 17:30 unless changed (Settings → General → Today →
*Working day starts* / *ends*, under More settings).

### Wrap up the day

From More, from the palette, or as Today's button late in the day: what is
left of today is listed and moves to tomorrow (untick any to keep it on
today). With the Journal on, one line can go into today's entry
("- 17:40 · Wrapped up: 3 done, 2 moved to tomorrow. Good call with Sam").

## Where it lives in the code

| What | Where |
| --- | --- |
| Cards, sizes, now and next, top three, Mail's strip | `core/today.ts`, `test/today.test.ts` |
| Free time, laying out, moving blocks, block events, wrap-up | `core/day-plan.ts`, `test/day-plan.test.ts` |
| Inbox items, sorting, note lines, snippet abbreviations | `core/inbox.ts`, `test/inbox.test.ts` |
| Hello's sections and the move to version 4 | `core/home-layout.ts`, `test/home-layout.test.ts` |
| Today on Hello | `src/today/Today.tsx` |
| Plan my day, Wrap up | `src/today/PlanMyDay.tsx` |
| The Inbox page, the card | `src/screens/Inbox.tsx`, `src/today/InboxCard.tsx` |
| Storage, IPC, the card window, shortcut, tray | `electron/services/inbox.ts`, `electron/ipc/inbox.ts` |
| End to end | `test/e2e/today.cjs` |

## Feature switches

| Switch | Covers | Default |
| --- | --- | --- |
| `captureInbox` | The Inbox page, its card, shortcut and tray entry, Today's Inbox card | on |
| `dayPlan` | Plan my day and Wrap up the day (needs `calendars`) | on, with Calendar and reminders |

Today itself belongs to Hello (the library), and each card to its own part.
Off, the Inbox has no shortcut, no card window and no tray entry.

## Platforms

Everything here is the same on macOS, Windows and Linux. The card is a
floating panel (an NSPanel on a Mac, a tool window on Windows, a toolbar
window that tiling window managers float on Linux). Some Linux desktops under
Wayland do not let apps take global shortcuts: there, use the tray entry, the
palette or a system shortcut for `keeper://inbox`.
