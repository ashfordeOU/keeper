# Knowledge graph

One map of everything Keeper knows on this computer, and how it connects: your files and notes, mail, the people in it, organisations, calendar events, tasks and projects, recorded meetings, places, saved pages and the apps meetings were recorded in. Every link says why it is there. It is built and kept on this computer and nothing is sent anywhere.

Part: **Knowledge graph of everything** (Settings → Features → AI, on by default, needs *Let AI search your files*). Page: **Knowledge Graph** in the sidebar.

## What becomes a node

| Kind | From |
|---|---|
| Files and notes | the library folders (notes first, then files with text, then the newest; up to 20,000), and Markdown notes in Notes vaults outside them (up to 3,000) |
| Mail | one node per conversation, from the mail kept on this computer — never Spam, Trash, sign-in codes or security mail; nothing is fetched from a server for the graph |
| People | one person however they are written: every address on their contact card, `lena.fischer@…` and `Lena.Fischer+lease@…`, “Fischer, Lena”, “Lena Fischer” and, when there is only one Fischer starting with L, “L. Fischer”. Gmail's dots are ignored. Your own addresses never become a node |
| Organisations | company e-mail domains (not Gmail, Outlook, iCloud and other free mail), the organisation on a contact card, and names with Ltd, GmbH, Inc and the like that appear in two or more things |
| Events | calendars on this computer and connected ones (holidays and birthdays left out) |
| Tasks and projects | Reminders and the Planner; a task's project (`#home`) is a node |
| Meetings | recordings in Meetings, with the event they belong to and the people who spoke |
| Places | named places in Places & Tracks (only while its vault is open) |
| Saved pages | pages saved for later or starred in Reader |
| Apps | the app a meeting was recorded in |
| Tags, folders, sources | as before; folders and sources are hidden unless chosen |

A name found only in text becomes a person when someone already is that person, or when two or more things name it.

## Why two things are linked

| Reason | Example |
|---|---|
| Emailed | “Lena Fischer wrote “Lease renewal” · 3 Nov 2026”, “Sent to Marco Rossi” |
| Attended | “Lena Fischer was invited to “Lease viewing””, “… organised …”, “… was in” a recorded meeting |
| Mentioned in | “Named in “Apartment move”” |
| Attached to | “lease.pdf came with “Lease renewal”” (an attachment saved from Mail is marked with where it came from, as browsers do, so even a renamed copy stays linked) |
| Linked | `[[wiki]]` and Markdown links both ways, a task or event made from an email, a meeting's event and its notes |
| Same project | a task's project, and notes tagged the same way |
| Tagged | `#tags` and Finder or Keeper tags |
| Near in time | notes and files changed, and mail that arrived, during an event (up to eight per event) |
| Same place | an event whose place is one of your named places |
| Similar meaning | with *Search by meaning* on: things about the same subject |
| Works at | a person and their organisation |
| Recorded in | a meeting and the app it came from |

## The page

- **Search first.** Type a person, project or topic: things in the graph come first, then matches inside mail, notes and files (by words and, when it is on, by meaning). Enter focuses the graph on the first. Press `/` to search from anywhere on the page.
- **Start with.** Before you search, a small card offers the people, organisations and projects that link most.
- **Map or Timeline.** The map is a force layout. The timeline puts things on lanes per kind along time, with the people and projects above; the selected thing's links are drawn as arcs.
- **Filters.** Time (past week, month, year) and kinds (*Usual* leaves out folders and sources; *Only people*).
- **Inspector.** The selected thing: one main action (Open, Open email, Open in Calendar, Email for a person, …), Focus, Show in folder, Add to note (a link in today's daily note), its links grouped by reason with the sentence for each, things linked through others, and **Explain a connection**: pick anything else and see the shortest chain of links between them (up to four), each with its reason.
- **Keyboard.** Tab to the map; arrow keys step through things by how linked they are, Enter focuses one, `+`/`−` zoom, `0` fits, Escape lets go.
- **What it includes** opens the privacy sheet (below).

### Large graphs

The graph itself is kept whole; the page draws at most 1,500 nodes. Beyond that it shows the best-linked ones and folds the rest into one dashed summary node per kind (“12,400 more mail”) linked to the hubs they connect to. Search and Focus reach anything. Building 100,000 nodes takes a few seconds once; after that only changed items are read again (`test/graph-everything.test.ts` checks a 100,000-node graph builds, updates one item faster than a full build, and summarises in well under a second).

## Related panels

The graph also answers “what is related to this?” where you are:

- **Notes** — at the bottom of the links panel, for the open note;
- **Mail** — under each message, “More with <sender>”;
- **Files** — in the inspector;
- **Calendar** — in the event editor.

Each panel is closed until you open it (nothing is asked of the graph before), lists up to six things with the reason, and has *Show in graph*.

## Privacy

- Built and stored only on this computer, in Keeper's data folder (`graph/graph.json`); nothing is sent anywhere.
- A part that is off adds nothing: no mail nodes while Mail is off, no events or tasks while Calendar and reminders is off, and so on.
- **What it includes** (on the Graph page, and Settings → AI → Knowledge graph): switch off mail, calendar events, tasks, contacts, meetings, places or saved pages; leave out a mail account, a mail folder or a folder on disk. Anything left out is dropped from the stored graph at the next look, and from search by meaning too.
- Files follow the library's excluded folders, like the rest of Keeper's brain.
- Other AI apps (over MCP) see mail threads only from accounts you shared with them (*Coding assistants and other AI apps may use this account*).

## Cost

Nothing runs in the background for the graph. When the Graph page, a Related panel, the Assistant or an agent asks, it catches up on what changed — at most every 30 seconds, at once after you change what it includes — and saves its pieces. About 30 MB per 100,000 things while in use.

## For agents and the Assistant

- `graph_search` finds people, organisations, projects, files, notes, mail threads, events, tasks, meetings, places and saved pages by name, address or title (filter with `kinds`).
- `graph_neighbors` takes a `path`, a person's `name` or `email`, or a node `id`, and lists what is linked with the reason for each.
- The Assistant also gets `search_everything` (see [BRAIN.md](BRAIN.md#search-by-meaning-over-more-than-files)) and `related_to`, and cites mail, events and other things like files: `[[keeper://mail/…]]`. Clicking a citation opens the email, the event, the meeting or the page.

## Platforms

Pure code on every system (macOS, Windows, Linux). Places come from Places & Tracks and need its vault open. Marking a saved attachment with where it came from uses the system's own way (macOS *Where from*, the Windows `Zone.Identifier` stream, Linux `user.xdg.origin.url` where `setfattr` exists); without it, attachments are still linked by their file name.

## How it was checked

- `test/graph-everything.test.ts` (27 tests): addresses, names and initials merging into one person; organisations from domains and cards; a link with its reason for every kind; names in reasons; only changed items read again; saving and loading; privacy choices and parts that are off; search, focus with a time filter, the related list, explanations; level of detail with 100,000 nodes.
- `test/e2e/graph.cjs` runs the real app (Linux, virtual display) with demo mail, a contact, an event, a task and a recorded meeting kept on this computer: Lena Fischer, written three ways, is one person linked to her mail, the meeting, the event, a note and a file; the saved attachment links to its email; Explain joins the lease to the viewing; leaving mail out removes it; the page's search, inspector, timeline and privacy sheet; the Related panels in Mail and Calendar; the Assistant cites the email by its subject. Screenshots light and dark.
- Not checked on a real Mac or Windows PC: the marking of saved attachments there (the code paths are the ones Keeper Link and cloud downloads already use).
