# Planner

Keeper has one task list, and one **Tasks** page for it in Mail & Calendar,
with two tabs: **Plan** (the days: Today, Week, Inbox, Upcoming, Overdue and
projects) and **Lists** (all reminders, Important, and each account's lists).
They used to be the Planner and Reminders pages; their routes, page windows
and the Keeper Planner and Keeper Reminders app icons still open their tab.
The Island's Tasks, Week and Insights tabs show the same tasks. A task is a
`Reminder` (`core/pim/types.ts`). Local tasks live on this computer, and
tasks in a calendar account's task list sync as VTODO over CalDAV.

## What a task has

| Field | Meaning | In VTODO (CalDAV) |
| --- | --- | --- |
| `title`, `notes` | what to do, and any notes | `SUMMARY`, `DESCRIPTION` |
| `due`, `remindAt` | a due time, and when to remind (defaults to `due`) | `DUE`, `VALARM` |
| `priority` | 0 none, 1 low (`!`), 2 medium (`!!`), 3 high (`!!!`) | `PRIORITY` 9 / 5 / 1 |
| `plannedFor` | the day it is planned for (`yyyy-mm-dd`). Without it and without a due date, a task is in the **Inbox** | `DTSTART;VALUE=DATE` |
| `rrule` | repeats (`FREQ=WEEKLY;BYDAY=MO`) | `RRULE` (written only with `DTSTART` or `DUE`, as RFC 5545 asks) |
| `steps` | sub-tasks, checked off on their own | `X-KEEPER-STEP;X-ID=…;X-DONE=0/1` |
| `project` | a project or area (`#home`) | first `CATEGORIES` |
| `order` | the person's own order (drag to reorder) | `X-KEEPER-ORDER` |
| `created` | when it was added | `CREATED` |
| `focus` | focus sessions spent on it | `X-KEEPER-FOCUS:at/minutes,…` |

Other apps keep the `X-` properties they do not know, so steps and order
survive a round trip through most servers.

## Views

All of them are pure functions in `core/pim/tasks.ts`, tested in `test/tasks.test.ts`.

- **Today**: tasks planned or due today, plus **carried-forward** tasks: unfinished ones whose day has passed show on today, marked "from Tuesday". They are not rewritten. The original day stays, so a synced task is not changed on the server every morning, and nothing runs at midnight. The windows turn the day over with one timer at midnight (`onNewDay`).
- **Week**: seven days from the week's first day (Settings → Mail & Calendar), next to the **Inbox**. Drag a task onto another day, or onto the Inbox to take its day away. A due time moves with it to the same time on the new day, and so does its reminder.
- **Inbox**: unfinished tasks with no day and no due date.
- **Upcoming**: the next 14 days, by day.
- **Overdue**: a due time that has passed, or a planned day before today. *Reschedule all to today* / *to tomorrow* moves them in one go (`pim.moveTasks`).
- **Projects**: every `#project` in use.
- **Insights**: see below.

## Today, Plan my day and Wrap up

Hello's **Today** shows the top three of today's tasks with tick boxes, and
**Plan my day** puts up to three tasks into the free time between your events
as calendar blocks that link back to their task (`keeper://task/<id>`); ticking
the block on Today ticks the task. **Wrap up the day** moves what is left to
tomorrow with `pim.moveTasks`. See [TODAY.md](TODAY.md). Things caught with the
Inbox shortcut become tasks from the Inbox page (key 1).

## Repeating tasks

Checking off a repeating task **rolls it on** to its next date (`completeTask`). The task stays the same, with the same UID, so a synced list shows one task, as Apple Reminders does. Its steps are unticked. The next date comes from the rule after the current one and never before today, so a daily task left for a week comes back tomorrow, not seven times. `COUNT` counts down, and the last occurrence is simply done. `UNTIL` is respected. Each completion is logged in Insights.

The roll happens in the main process (`electron/services/pim`), whichever window checked the task off, and for AI agents too.

## Plain words

`parseTask` (`core/pim/quickadd.ts`) reads:

- `!`, `!!`, `!!!` on their own: priority. An exclamation mark at the end of a word stays part of it.
- `#project`
- dates and times, as in Calendar quick-add: `tomorrow 3pm`, `friday`, `12/20 at 4`, `in 2 days`, `tonight`
- repeats: `every day`, `daily`, `every weekday`, `every week`, `every Mon and Thu`, `every other Friday`, `every 2 weeks`, `every month`, `yearly`

A time sets the due time. A date alone sets the planned day. A repeat with no date starts today, or on its first weekday. A place ("at the office") stays in the title. Day names match only real day names, so "month" and "monster" are no longer read as Monday (this fixes Calendar quick-add too).

The composer (`TaskComposer`, `src/pim/tasks-ui.tsx`) shows what the words set as you type. It has a dictation button: it puts the cursor in the field and starts Keeper's dictation (Settings → Dictation), which types the words there.

## Where to add tasks

- The Island's **Tasks** tab, or from anywhere with **New task** (<kbd>Ctrl Alt N</kbd>, <kbd>⌘⌥N</kbd> on a Mac). The shortcut opens Tasks with the field focused. Change it in Settings → Island → Shortcuts.
- The **Week** tab and the Planner's Week, with *+ Add* under any day.
- The **Tasks** page's Plan and Lists tabs.
- **Island Notes**: <kbd>⌘/Ctrl Enter</kbd> turns the line under the cursor into a task for today, and the line leaves the note.
- AI agents and MCP clients (below), and the command palette (*New Task…*).

## Due reminders in the Island

When a task's reminder time comes (`remindAt`, or `due`), the main process's one alarm timer rings it, as before. It now also becomes a **reminder** live activity. It takes the pill (above music and calls, below recording and dictation), chimes once in the Island, and stays until **Done** or **Snooze 5 min** on its card. A notification and an alert of kind `reminder` go out too. `core/island-expand.ts` counts `reminder` as urgent, so it shows even when general alerts are hidden. Moving the task later, checking it off or deleting it ends the activity. Stage mode hides the titles. Settings → Island → Live activities can switch reminders off.

## Focus

- Countdown (25, 50 or any length on the ruler) or **stopwatch** (counts up).
- **+5 min** on the Timers tab and on the timer's card.
- A session can be **for a task**: pick one of today's tasks on the Timers tab, or press *Focus* in a task's details. The minutes actually focused (pauses left out) are logged on the task (`focus`) and in Insights when the block finishes or is stopped.
- **Sleep and lock** pause a running session (`powerMonitor` `suspend` / `lock-screen`). Waking or unlocking (`resume` / `unlock-screen`) carries it on, but only if the system paused it, never one the person paused. The one-second tick runs only while a session is counting.

## Insights

A small log in Mail & Calendar's state file (`state.log`): one entry when a task is checked off and one when a focus session ends. At most 5,000 entries over 120 days. Nothing leaves the computer, and the *Insights* feature switch stops the logging. `core/pim/insights.ts` adds it up:

- done today and this week, focus minutes today and this week
- the last seven days
- activity by hour of day over four weeks (focus minutes in the hours they covered, plus 10 for each task done), the three busiest hours, and a streak of days with something done

Shown in the Island's **Insights** tab and the Planner's **Insights** view.

## Deleting, reordering, export

- Delete with the ×, the Delete key on a focused row, or a two-finger swipe to the left on a trackpad (a finger swipe on a touch screen). An **Undo** bar stays for six seconds and puts the task back. A synced task is written to the server again.
- Drag rows to reorder them within a list.
- Settings → Tasks and notes → **Export** saves every task and every Island note and script as one JSON file. Server paths and version tags are left out.

## AI and MCP

Actions in `core/brain/actions.ts`, with the permission rules every action follows (Agents → Permissions):

| Action | Default |
| --- | --- |
| `tasks_list` (today, inbox, overdue, upcoming, week, all; by project) | allowed (read only) |
| `insights_get` | allowed (read only) |
| `island_notes_read` | asks (notes are private) |
| `task_add` (plain words or fields), `task_update`, `task_complete`, `task_delete` | asks |
| `island_notes_append` (today's pad unless a note is named) | asks |
| `focus_timer` (start, stopwatch, extend, stop; optionally for a task) | asks |

Each action refuses with a plain message when its feature is switched off.

## The Island's old to-dos

Before, the Island kept its own to-do list in `island-tools.json`. On the first start with this version, those to-dos become local tasks: starred ones become high priority, and the order is kept (`todosToTasks`, run once by `adoptIslandTodos`). The Island's file then keeps no to-dos. The move is marked in `state.migrated.islandTodos`, and the tasks keep the ids `local:island-…`, so it never runs twice.

## Feature switches

| Switch | What it covers | Default |
| --- | --- | --- |
| `calendars` | reminders and tasks at all | on |
| `planner` | the Planner page (needs `calendars`) | on |
| `insights` | the Insights log and views | on |
| `islandTodos` | the Island's Tasks tab, due reminders in the Island, the New task shortcut, Cmd/Ctrl+Enter in Notes | on |
| `islandPlanner` | the Island's Week tab | on |
| `islandInsights` | the Island's Insights tab | on |

## Cost

Nothing new runs on a timer. Task views reload when the main process says the task list changed (`pim-changed`). Insights reload the same way. Due reminders use the alarm timer that already existed. The macOS Reminders section of the Island's Tasks tab used to be asked every minute while open. It is now asked when the tab opens and when the Island comes back into view.

## Files

- `core/pim/tasks.ts`, `core/pim/insights.ts`, `core/pim/quickadd.ts` (`parseTask`), `core/pim/ical.ts` (VTODO fields)
- `electron/services/pim/index.ts`: saving, rolling, moving, reordering, snoozing, Insights, and due reminders for the Island
- `src/pim/tasks-ui.tsx` (composer, rows, detail, Undo), `src/pim/planner-views.tsx` (Week board, Insights), `src/pim/Planner.tsx`, `src/pim/Reminders.tsx`
- `src/island/tools/IslandPlanner.tsx` (Tasks, Week, Insights, the focus task picker)
- `test/tasks.test.ts`, plus focus tests in `test/island.test.ts` and activity tests in `test/island-place.test.ts`

## Not done yet

- Two-way sync with Apple Reminders through EventKit, and priority suggestions from an on-device AI. The Island still lists the Mac's Reminders, read and checked off through the helper.
