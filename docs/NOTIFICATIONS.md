# Notifications

Every notice Keeper gives (new mail, a site that went down, something new on the Fix-it List, an update) goes to one place: the **bell** in the top bar. The bell shows how many are open. Click it to see them, grouped by the part they came from, newest first.

## The notification center

- **Click a notice** to open its page (Mail, Monitors, the Fix-it List…). It is marked done.
- **✓** marks one done. **Mark all done** clears the open list.
- **Snooze all 1 h** holds every notice for an hour. **Stop snoozing** ends it early.
- The line under the title says what is happening: *Quiet until 08:00*, *Held while you focus*, *Snoozed until 14:30* or *Next batch at 13:00*.
- When nothing is open, the sheet says *All caught up*.

The command palette has **Notifications** and **Snooze Notifications for 1 Hour**.

## How each part tells you

Settings → General → Notifications. Each part that gives notices has three choices:

| Choice | What happens |
|---|---|
| **Now** | Shown as it happens: in the Island when it is on, otherwise as the system's own notification. |
| **Batched** | Gathered and shown as one calm summary ("3 notices · 2 from Mail, 1 from Sites and servers") at 9, 13 and 17, or every hour. |
| **Silent** | Only listed in the bell. |

Out of the box, Mail, Calendar and reminders, Sites and servers, and Network & firewall are **Now**. Privacy & Security, the Fix-it List, Health, AI usage, Reader, Keeper updates and Keeper itself are **Batched**. **Send a test notice** shows one at once.

Every notice is listed in the bell whatever the choice. A summary click opens the bell.

## Quiet hours and focus

- **Quiet hours** (off until switched on; 22:00 to 08:00 to start with): nothing is shown in those hours. Held notices come as one summary when they end.
- **Hold notices while I focus**: while Keeper's focus timer runs, notices wait. They come when the session ends.
- **Follow Do Not Disturb** (More settings): Keeper holds notices while the system's own Do Not Disturb is on, where it can read it. Today that is GNOME and desktops built on it (`org.gnome.desktop.notifications show-banners`). On macOS and Windows, Focus and Do Not Disturb cannot be read by other apps, so Keeper's own quiet hours and focus timer are the way to hold notices there.
- **Urgent notices always come through**: alarms and timers, a restart for an update about to happen, and the test notice.

Things that answer what you just did ("Sending…" with Undo, "Copied the text", a screenshot) are not notices and are shown at once, as before.

## What it costs

Nothing while nothing waits: there is one timer, and only while a notice is held for its batch or a quiet time. The list is kept in `notices.json` in Keeper's data folder (the newest 200). The same notice again within ten minutes is counted on the open one ("×3"), not listed twice. Switching **Notification center** off (Settings → Features → Keeper itself) shows every notice at once, as before, and lists nothing.

## For developers

- `core/notices.ts`: the parts and their defaults, quiet hours, what happens to a new notice (`decide`), batch times (`nextBatchAt`, `releaseAt`), the list (`addNotice`, `groupByPart`) and the summary. Unit tests in `test/notices.test.ts`.
- `electron/services/notices.ts`: `notice({ part, title, detail, route, urgent }, showNow?)`, the list on disk and the one timer. `noticeFor(part, route)` makes the `(title, detail)` callback most services take.
- `src/components/Notices.tsx`: the bell, the sheet and the two Settings panels.
- Wired today: Mail (new mail, replies not yet received, snoozes back), reminders, Sites and servers, Network Activity, Network & firewall, Privacy & Security, the Fix-it List, Health, AI usage, Reader, Keeper updates and downloadable components.

## Verified

- Unit tests: settings, defaults, quiet hours past midnight, holds (snooze, quiet, focus, Do Not Disturb), urgent notices, batch times, release times, the summary, counting repeats, the 200 cap and grouping.
- The real app on Linux (`test/e2e/attention.cjs`): the bell and its count, the sheet grouped by part, Mark all done, Snooze all with its status line, the per-part choices in Settings, and screenshots in light and dark.
- **Not verified here:** the system notification when the Island is off on macOS and Windows, and Do Not Disturb on GNOME with a real session bus.
