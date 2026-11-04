<!-- SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0 -->
# Send to…

One menu turns anything in Keeper into something else. It is the same everywhere, so you learn it once.

## Where it is

- **Files**: right-click a file or a selection → **Send to…**, or **Send to…** in the Inspector.
- **Mail**: right-click a message → **Send to…**.
- **Notes**: right-click a note in the file list → **Send to…**.
- **Command palette**: **Send Selection to…** sends the selected files.

## The eight choices

| Key | Choice | What happens | Needs |
| --- | --- | --- | --- |
| 1 | Note | A line in today's daily note, with links to the files | Notes |
| 2 | Task | A task; its notes hold the rest and the link back | Calendar and reminders |
| 3 | Event | Asks "When?" (for example "friday 3pm") and adds it to your calendar | Calendar and reminders |
| 4 | Mail | A new message with the words, or the files attached | Mail |
| 5 | Device | The Send to Device sheet (files only) | Keeper on your other devices |
| 6 | AI | The assistant, with a question about it filled in | Assistant |
| 7 | Shelf | The Island's shelf (files only) | Island |
| 8 | Cue | A cue that carries it | Cues |

A choice that cannot be used now stays in its place, dimmed, and says why.

## The link back

Every copy keeps one line saying where it came from, for example `from mail: Invoice October (keeper://mail/…)`. Opening the link shows the original: `keeper://mail/<id>` opens the message, `keeper://open?path=…` shows the file and `keeper://notes?open=<note>` opens the note.

Task, event, note and cue copies can be undone from the message that follows.

## For developers

- The verbs and how each kind becomes a task, a note line, an event, a draft mail, a question or a cue: `core/send-to.ts` (tests in `test/send-to.test.ts`).
- The sheet and running the verbs with Keeper's own parts: `src/components/SendTo.tsx` (`openSendTo(item)` from anywhere).
- End-to-end: `test/e2e/reach.cjs sendto`.
