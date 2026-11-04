<!-- SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0 -->
# Accessibility conformance report

How Keeper meets the Web Content Accessibility Guidelines (WCAG) 2.2 at levels A and AA. The same success criteria make up the web and software parts of EN 301 549 (the European standard, chapters 9 and 11) and of the US Section 508 standards, so this report answers both for those criteria. Organisations and schools can use it in their buying process.

The tables below are made from `core/a11y-conformance.ts`; `test/a11y-conformance.test.ts` fails if they differ, and checks that every A and AA criterion of WCAG 2.2 is listed. What is supported and how is in [Accessibility in Keeper](ACCESSIBILITY.md); its *Known limits* are the reasons for each "Partially supports".

<!-- conformance:start -->
**Keeper by Ashforde® 1.0** · 2026-11-04

**Scope.** The main window and the windows it opens (pages in their own window, dialogs, Quick Look, Quick Search) on macOS, Windows and Linux. The Island, desktop widgets and the phone companion page are listed separately where they differ.

**How it was checked.** Keeper’s own automated checks on every page in light and dark (test/e2e/a11y.cjs: names, roles, ARIA references, keyboard reach, contrast of plain text), contrast tests for all 38 themes (test/a11y-contrast.test.ts), and testing by hand with a keyboard. Screen reader passes with VoiceOver, NVDA, Narrator and Orca are done by hand each release (docs/BETA-CHECKLIST.md).

**Summary.** 55 criteria: 37 supported, 12 partly, 0 not supported, 6 not applicable.

### Level A

| Criterion | Conformance | Remarks |
| --- | --- | --- |
| 1.1.1 Non-text Content | Partially supports | Icon buttons have names, file thumbnails are marked decorative (the name, size and date are beside them). Charts, the space map, the world map, the knowledge graph and wallpaper scenes are pictures; their main numbers are in text beside them, but the pictures cannot be explored with a screen reader. |
| 1.2.1 Audio-only and Video-only (Prerecorded) | Not applicable | Keeper has no recorded audio or video of its own; it plays people’s own files. |
| 1.2.2 Captions (Prerecorded) | Not applicable | No recorded video of Keeper’s own. Meeting recordings get a written transcript on this computer. |
| 1.2.3 Audio Description or Media Alternative (Prerecorded) | Not applicable | No recorded video of Keeper’s own. |
| 1.3.1 Info and Relationships | Supports | Landmarks (navigation, main, complementary), headings, lists, tables with sortable column buttons and aria-sort, tree, listbox, tabs, radio groups, switches and dialogs use their proper roles and states. |
| 1.3.2 Meaningful Sequence | Supports | Reading and focus order follow the visual order: sidebar, page, inspector. |
| 1.3.3 Sensory Characteristics | Supports | Instructions name controls by their words, not only by shape, place or colour. |
| 1.4.1 Use of Color | Supports | States are said in words or icons as well as colour (Within its budget / Over its 250 MB, status badges with text). Unavailable rows differ in words, not only fading. |
| 1.4.2 Audio Control | Supports | Ambient sound and media start only when asked and have pause and volume controls; nothing plays by itself on opening a page. |
| 2.1.1 Keyboard | Partially supports | Pages, menus, lists, tables, dialogs, the palette and Quick Search work with the keyboard alone (shortcuts in docs/ACCESSIBILITY.md). Drawing on the screen, the photo editor’s brushes, the space map’s bubbles and remote screens need a pointer; their actions are also in menus where possible. |
| 2.1.2 No Keyboard Trap | Supports | Dialogs keep Tab inside while open and Esc closes them, returning focus. The terminal takes Tab for the shell; Ctrl+Tab and the window’s shortcuts still move out. |
| 2.1.4 Character Key Shortcuts | Partially supports | Single keys act only while focus is on their own page and never in text fields (number keys in the Inbox and Send to, letters to jump in lists). They cannot yet be switched off or changed. |
| 2.2.1 Timing Adjustable | Partially supports | Nothing a person must do has a time limit. Messages with Undo disappear after a few seconds; History keeps every change to undo later. |
| 2.2.2 Pause, Stop, Hide | Supports | Reduce motion (or the system’s setting) stops animations and moving wallpapers; live readings update without moving. |
| 2.3.1 Three Flashes or Below Threshold | Supports | Nothing in Keeper flashes or blinks. |
| 2.4.1 Bypass Blocks | Supports | The first Tab shows Skip to content; landmarks separate the sidebar, the page and the inspector. |
| 2.4.2 Page Titled | Supports | Each page has a title, and the window’s title says which page is open. |
| 2.4.3 Focus Order | Supports | Focus moves in reading order; dialogs take focus and give it back. |
| 2.4.4 Link Purpose (In Context) | Supports | Links and link-like buttons say where they go (Open Inbox, Restart or stop a part). |
| 2.5.1 Pointer Gestures | Supports | Zooming in the PDF reader, Quick Look and the photo editor also has buttons and keys; moving between items has Previous and Next. |
| 2.5.2 Pointer Cancellation | Supports | Buttons act on release; moving off cancels. |
| 2.5.3 Label in Name | Supports | Names start with the words shown on the control. |
| 2.5.4 Motion Actuation | Not applicable | Nothing in Keeper responds to shaking or tilting. |
| 3.1.1 Language of Page | Supports | Windows say they are in English. Partly translated languages are offered only with More settings shown (docs/TRANSLATING.md). |
| 3.2.1 On Focus | Supports | Focus never opens or changes pages by itself. |
| 3.2.2 On Input | Supports | Changing a setting applies it in place; nothing navigates away. |
| 3.2.6 Consistent Help | Supports | Help (the ? button and F1) is in the same place on every page. |
| 3.3.1 Error Identification | Supports | Errors are said in words next to the field or in a message read by screen readers. |
| 3.3.2 Labels or Instructions | Partially supports | Fields have labels. A few search and filter fields are named only by their placeholder. |
| 3.3.7 Redundant Entry | Supports | Keeper fills in what it already knows (accounts, folders, the last choices) instead of asking again. |
| 4.1.2 Name, Role, Value | Supports | Controls expose their name, role and state; a safety net names any field left without one from its row. |

### Level AA

| Criterion | Conformance | Remarks |
| --- | --- | --- |
| 1.2.4 Captions (Live) | Not applicable | Keeper does not stream live audio or video of its own. Live meeting transcripts are offered for people’s own calls. |
| 1.2.5 Audio Description (Prerecorded) | Not applicable | No recorded video of Keeper’s own. |
| 1.3.4 Orientation | Supports | Windows work at any shape; nothing is locked to landscape or portrait. |
| 1.3.5 Identify Input Purpose | Partially supports | Server connection and backup password fields are marked for the system’s autofill. Mail account and contact forms do not mark e-mail and name fields yet. |
| 1.4.3 Contrast (Minimum) | Supports | Every theme, light and dark, meets 4.5:1 for body, secondary and muted text on windows, cards, sunk panels and hovered rows, checked by test/a11y-contrast.test.ts. Text over wallpaper scenes and photos cannot be checked automatically. |
| 1.4.4 Resize Text | Supports | Text size up to 200% in Settings → Accessibility, without loss of content: the window zooms, or with Wrap larger text the text grows and wraps. The Island and small floating pills keep their size. |
| 1.4.5 Images of Text | Supports | Keeper’s words are text. Pictures of text are only people’s own files. |
| 1.4.10 Reflow | Partially supports | Pages fit a 1024 pixel wide window, and Wrap larger text lets text grow without scrolling sideways. Some wide tables (processes, network connections) and a few older stylesheets that size text in pixels still need sideways scrolling at the largest sizes. |
| 1.4.11 Non-text Contrast | Supports | The accent and status colours used on controls meet 3:1 in every theme; focus rings are 2 pixels in the accent colour. More contrast and the system’s contrast themes are followed. |
| 1.4.12 Text Spacing | Partially supports | Line spacing (to 1.8) and letter spacing can be set for pages, notes, mail, dialogs and help in Settings → Accessibility. A few compact controls (tab strips, chips) may clip with very wide spacing. |
| 1.4.13 Content on Hover or Focus | Supports | Tooltips and hover cards stay while the pointer is over them and close with Esc. |
| 2.4.5 Multiple Ways | Supports | Every page is in the sidebar, the command palette and Settings search. |
| 2.4.6 Headings and Labels | Supports | Short plain titles; fields and switches take their row’s title as their name. |
| 2.4.7 Focus Visible | Supports | A 2 pixel focus ring after keyboard use, or always with Always show focus outlines. |
| 2.4.11 Focus Not Obscured (Minimum) | Partially supports | Focused items scroll into view. In long lists with a header that stays in place, and behind a message at the foot of the window, a focused row can be partly covered for a moment. |
| 2.5.7 Dragging Movements | Partially supports | Moving files, tasks and cards by dragging also has Move to…, Cut and Paste, and keyboard moves. Arranging desktop widgets and drawing need dragging. |
| 2.5.8 Target Size (Minimum) | Partially supports | Most controls are at least 24 by 24 pixels or well spaced; Larger buttons makes them all at least 44 pixels. A few small icon buttons in dense lists are under 24 pixels without it. |
| 3.1.2 Language of Parts | Partially supports | Keeper does not mark the language of people’s own notes, mail and file names, which may differ from the interface. |
| 3.2.3 Consistent Navigation | Supports | The sidebar, top bar and palette stay the same on every page. |
| 3.2.4 Consistent Identification | Supports | The same action has the same name and icon everywhere (Send to…, Undo, Move to Trash). |
| 3.3.3 Error Suggestion | Supports | Messages say what to do (“Add a day or time, like friday 3pm”, “Use 8 characters or more”). |
| 3.3.4 Error Prevention (Legal, Financial, Data) | Supports | Deleting moves to the Trash with Undo; clean up, rename and restore show what will happen first and can be undone. |
| 3.3.8 Accessible Authentication (Minimum) | Supports | Passwords can be pasted and filled by password managers; pairing compares six digits shown on both screens, with no puzzle to solve. |
| 4.1.3 Status Messages | Supports | Messages, Island alerts and the start and end of long jobs are announced without moving focus. |
<!-- conformance:end -->

## Not covered here

- **EN 301 549 chapters beyond the web criteria** (two-way voice, hardware, documentation and support services). Keeper's documentation is these pages, in Markdown, readable by screen readers on GitHub and in any editor.
- **Level AAA** criteria are not claimed.
- **The Island, widgets and the phone companion page** follow the same components, with two differences: they keep their size when text size grows, and the Island's alerts may not be read while another app is in front (some screen readers only read the window in front).

## Keeping it true

Each release, the automated checks run in the build, and the screen reader passes in [the beta checklist](BETA-CHECKLIST.md#14-accessibility-by-hand-about-45-minutes) are done by hand on a Mac (VoiceOver), Windows (NVDA and Narrator) and Linux (Orca). Change a status here only with what was checked.
