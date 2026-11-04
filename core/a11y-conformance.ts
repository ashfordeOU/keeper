// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper's accessibility conformance report: every WCAG 2.2 level A and AA
// success criterion, how far Keeper's main window meets it, and why. The same
// criteria are the web part of EN 301 549 (chapter 9, and 11 for software)
// and of Section 508. docs/ACCESSIBILITY-CONFORMANCE.md is made from this list
// (test/a11y-conformance.test.ts keeps them in step), so the report never
// drifts from what was decided here.

export type Conformance = 'Supports' | 'Partially supports' | 'Does not support' | 'Not applicable';

export interface Criterion {
  id: string;
  name: string;
  level: 'A' | 'AA';
  status: Conformance;
  /** why, in plain words: what works, what does not, where to find more */
  remarks: string;
}

export const REPORT = {
  product: 'Keeper by Ashforde®',
  version: '1.0',
  date: '2026-11-04',
  scope: 'The main window and the windows it opens (pages in their own window, dialogs, Quick Look, Quick Search) on macOS, Windows and Linux. The Island, desktop widgets and the phone companion page are listed separately where they differ.',
  method: 'Keeper’s own automated checks on every page in light and dark (test/e2e/a11y.cjs: names, roles, ARIA references, keyboard reach, contrast of plain text), contrast tests for all 38 themes (test/a11y-contrast.test.ts), and testing by hand with a keyboard. Screen reader passes with VoiceOver, NVDA, Narrator and Orca are done by hand each release (docs/BETA-CHECKLIST.md).',
};

export const CRITERIA: Criterion[] = [
  { id: '1.1.1', name: 'Non-text Content', level: 'A', status: 'Partially supports', remarks: 'Icon buttons have names, file thumbnails are marked decorative (the name, size and date are beside them). Charts, the space map, the world map, the knowledge graph and wallpaper scenes are pictures; their main numbers are in text beside them, but the pictures cannot be explored with a screen reader.' },
  { id: '1.2.1', name: 'Audio-only and Video-only (Prerecorded)', level: 'A', status: 'Not applicable', remarks: 'Keeper has no recorded audio or video of its own; it plays people’s own files.' },
  { id: '1.2.2', name: 'Captions (Prerecorded)', level: 'A', status: 'Not applicable', remarks: 'No recorded video of Keeper’s own. Meeting recordings get a written transcript on this computer.' },
  { id: '1.2.3', name: 'Audio Description or Media Alternative (Prerecorded)', level: 'A', status: 'Not applicable', remarks: 'No recorded video of Keeper’s own.' },
  { id: '1.2.4', name: 'Captions (Live)', level: 'AA', status: 'Not applicable', remarks: 'Keeper does not stream live audio or video of its own. Live meeting transcripts are offered for people’s own calls.' },
  { id: '1.2.5', name: 'Audio Description (Prerecorded)', level: 'AA', status: 'Not applicable', remarks: 'No recorded video of Keeper’s own.' },
  { id: '1.3.1', name: 'Info and Relationships', level: 'A', status: 'Supports', remarks: 'Landmarks (navigation, main, complementary), headings, lists, tables with sortable column buttons and aria-sort, tree, listbox, tabs, radio groups, switches and dialogs use their proper roles and states.' },
  { id: '1.3.2', name: 'Meaningful Sequence', level: 'A', status: 'Supports', remarks: 'Reading and focus order follow the visual order: sidebar, page, inspector.' },
  { id: '1.3.3', name: 'Sensory Characteristics', level: 'A', status: 'Supports', remarks: 'Instructions name controls by their words, not only by shape, place or colour.' },
  { id: '1.3.4', name: 'Orientation', level: 'AA', status: 'Supports', remarks: 'Windows work at any shape; nothing is locked to landscape or portrait.' },
  { id: '1.3.5', name: 'Identify Input Purpose', level: 'AA', status: 'Partially supports', remarks: 'Server connection and backup password fields are marked for the system’s autofill. Mail account and contact forms do not mark e-mail and name fields yet.' },
  { id: '1.4.1', name: 'Use of Color', level: 'A', status: 'Supports', remarks: 'States are said in words or icons as well as colour (Within its budget / Over its 250 MB, status badges with text). Unavailable rows differ in words, not only fading.' },
  { id: '1.4.2', name: 'Audio Control', level: 'A', status: 'Supports', remarks: 'Ambient sound and media start only when asked and have pause and volume controls; nothing plays by itself on opening a page.' },
  { id: '1.4.3', name: 'Contrast (Minimum)', level: 'AA', status: 'Supports', remarks: 'Every theme, light and dark, meets 4.5:1 for body, secondary and muted text on windows, cards, sunk panels and hovered rows, checked by test/a11y-contrast.test.ts. Text over wallpaper scenes and photos cannot be checked automatically.' },
  { id: '1.4.4', name: 'Resize Text', level: 'AA', status: 'Supports', remarks: 'Text size up to 200% in Settings → Accessibility, without loss of content: the window zooms, or with Wrap larger text the text grows and wraps. The Island and small floating pills keep their size.' },
  { id: '1.4.5', name: 'Images of Text', level: 'AA', status: 'Supports', remarks: 'Keeper’s words are text. Pictures of text are only people’s own files.' },
  { id: '1.4.10', name: 'Reflow', level: 'AA', status: 'Partially supports', remarks: 'Pages fit a 1024 pixel wide window, and Wrap larger text lets text grow without scrolling sideways. Some wide tables (processes, network connections) and a few older stylesheets that size text in pixels still need sideways scrolling at the largest sizes.' },
  { id: '1.4.11', name: 'Non-text Contrast', level: 'AA', status: 'Supports', remarks: 'The accent and status colours used on controls meet 3:1 in every theme; focus rings are 2 pixels in the accent colour. More contrast and the system’s contrast themes are followed.' },
  { id: '1.4.12', name: 'Text Spacing', level: 'AA', status: 'Partially supports', remarks: 'Line spacing (to 1.8) and letter spacing can be set for pages, notes, mail, dialogs and help in Settings → Accessibility. A few compact controls (tab strips, chips) may clip with very wide spacing.' },
  { id: '1.4.13', name: 'Content on Hover or Focus', level: 'AA', status: 'Supports', remarks: 'Tooltips and hover cards stay while the pointer is over them and close with Esc.' },
  { id: '2.1.1', name: 'Keyboard', level: 'A', status: 'Partially supports', remarks: 'Pages, menus, lists, tables, dialogs, the palette and Quick Search work with the keyboard alone (shortcuts in docs/ACCESSIBILITY.md). Drawing on the screen, the photo editor’s brushes, the space map’s bubbles and remote screens need a pointer; their actions are also in menus where possible.' },
  { id: '2.1.2', name: 'No Keyboard Trap', level: 'A', status: 'Supports', remarks: 'Dialogs keep Tab inside while open and Esc closes them, returning focus. The terminal takes Tab for the shell; Ctrl+Tab and the window’s shortcuts still move out.' },
  { id: '2.1.4', name: 'Character Key Shortcuts', level: 'A', status: 'Partially supports', remarks: 'Single keys act only while focus is on their own page and never in text fields (number keys in the Inbox and Send to, letters to jump in lists). They cannot yet be switched off or changed.' },
  { id: '2.2.1', name: 'Timing Adjustable', level: 'A', status: 'Partially supports', remarks: 'Nothing a person must do has a time limit. Messages with Undo disappear after a few seconds; History keeps every change to undo later.' },
  { id: '2.2.2', name: 'Pause, Stop, Hide', level: 'A', status: 'Supports', remarks: 'Reduce motion (or the system’s setting) stops animations and moving wallpapers; live readings update without moving.' },
  { id: '2.3.1', name: 'Three Flashes or Below Threshold', level: 'A', status: 'Supports', remarks: 'Nothing in Keeper flashes or blinks.' },
  { id: '2.4.1', name: 'Bypass Blocks', level: 'A', status: 'Supports', remarks: 'The first Tab shows Skip to content; landmarks separate the sidebar, the page and the inspector.' },
  { id: '2.4.2', name: 'Page Titled', level: 'A', status: 'Supports', remarks: 'Each page has a title, and the window’s title says which page is open.' },
  { id: '2.4.3', name: 'Focus Order', level: 'A', status: 'Supports', remarks: 'Focus moves in reading order; dialogs take focus and give it back.' },
  { id: '2.4.4', name: 'Link Purpose (In Context)', level: 'A', status: 'Supports', remarks: 'Links and link-like buttons say where they go (Open Inbox, Restart or stop a part).' },
  { id: '2.4.5', name: 'Multiple Ways', level: 'AA', status: 'Supports', remarks: 'Every page is in the sidebar, the command palette and Settings search.' },
  { id: '2.4.6', name: 'Headings and Labels', level: 'AA', status: 'Supports', remarks: 'Short plain titles; fields and switches take their row’s title as their name.' },
  { id: '2.4.7', name: 'Focus Visible', level: 'AA', status: 'Supports', remarks: 'A 2 pixel focus ring after keyboard use, or always with Always show focus outlines.' },
  { id: '2.4.11', name: 'Focus Not Obscured (Minimum)', level: 'AA', status: 'Partially supports', remarks: 'Focused items scroll into view. In long lists with a header that stays in place, and behind a message at the foot of the window, a focused row can be partly covered for a moment.' },
  { id: '2.5.1', name: 'Pointer Gestures', level: 'A', status: 'Supports', remarks: 'Zooming in the PDF reader, Quick Look and the photo editor also has buttons and keys; moving between items has Previous and Next.' },
  { id: '2.5.2', name: 'Pointer Cancellation', level: 'A', status: 'Supports', remarks: 'Buttons act on release; moving off cancels.' },
  { id: '2.5.3', name: 'Label in Name', level: 'A', status: 'Supports', remarks: 'Names start with the words shown on the control.' },
  { id: '2.5.4', name: 'Motion Actuation', level: 'A', status: 'Not applicable', remarks: 'Nothing in Keeper responds to shaking or tilting.' },
  { id: '2.5.7', name: 'Dragging Movements', level: 'AA', status: 'Partially supports', remarks: 'Moving files, tasks and cards by dragging also has Move to…, Cut and Paste, and keyboard moves. Arranging desktop widgets and drawing need dragging.' },
  { id: '2.5.8', name: 'Target Size (Minimum)', level: 'AA', status: 'Partially supports', remarks: 'Most controls are at least 24 by 24 pixels or well spaced; Larger buttons makes them all at least 44 pixels. A few small icon buttons in dense lists are under 24 pixels without it.' },
  { id: '3.1.1', name: 'Language of Page', level: 'A', status: 'Supports', remarks: 'Windows say they are in English. Partly translated languages are offered only with More settings shown (docs/TRANSLATING.md).' },
  { id: '3.1.2', name: 'Language of Parts', level: 'AA', status: 'Partially supports', remarks: 'Keeper does not mark the language of people’s own notes, mail and file names, which may differ from the interface.' },
  { id: '3.2.1', name: 'On Focus', level: 'A', status: 'Supports', remarks: 'Focus never opens or changes pages by itself.' },
  { id: '3.2.2', name: 'On Input', level: 'A', status: 'Supports', remarks: 'Changing a setting applies it in place; nothing navigates away.' },
  { id: '3.2.3', name: 'Consistent Navigation', level: 'AA', status: 'Supports', remarks: 'The sidebar, top bar and palette stay the same on every page.' },
  { id: '3.2.4', name: 'Consistent Identification', level: 'AA', status: 'Supports', remarks: 'The same action has the same name and icon everywhere (Send to…, Undo, Move to Trash).' },
  { id: '3.2.6', name: 'Consistent Help', level: 'A', status: 'Supports', remarks: 'Help (the ? button and F1) is in the same place on every page.' },
  { id: '3.3.1', name: 'Error Identification', level: 'A', status: 'Supports', remarks: 'Errors are said in words next to the field or in a message read by screen readers.' },
  { id: '3.3.2', name: 'Labels or Instructions', level: 'A', status: 'Partially supports', remarks: 'Fields have labels. A few search and filter fields are named only by their placeholder.' },
  { id: '3.3.3', name: 'Error Suggestion', level: 'AA', status: 'Supports', remarks: 'Messages say what to do (“Add a day or time, like friday 3pm”, “Use 8 characters or more”).' },
  { id: '3.3.4', name: 'Error Prevention (Legal, Financial, Data)', level: 'AA', status: 'Supports', remarks: 'Deleting moves to the Trash with Undo; clean up, rename and restore show what will happen first and can be undone.' },
  { id: '3.3.7', name: 'Redundant Entry', level: 'A', status: 'Supports', remarks: 'Keeper fills in what it already knows (accounts, folders, the last choices) instead of asking again.' },
  { id: '3.3.8', name: 'Accessible Authentication (Minimum)', level: 'AA', status: 'Supports', remarks: 'Passwords can be pasted and filled by password managers; pairing compares six digits shown on both screens, with no puzzle to solve.' },
  { id: '4.1.2', name: 'Name, Role, Value', level: 'A', status: 'Supports', remarks: 'Controls expose their name, role and state; a safety net names any field left without one from its row.' },
  { id: '4.1.3', name: 'Status Messages', level: 'AA', status: 'Supports', remarks: 'Messages, Island alerts and the start and end of long jobs are announced without moving focus.' },
];

/** How many criteria have each status. */
export function tally(list = CRITERIA): Record<Conformance, number> {
  const out: Record<Conformance, number> = { Supports: 0, 'Partially supports': 0, 'Does not support': 0, 'Not applicable': 0 };
  for (const c of list) out[c.status]++;
  return out;
}

/** The report's tables, for docs/ACCESSIBILITY-CONFORMANCE.md. */
export function conformanceDoc(): string {
  const t = tally();
  const rows = (level: 'A' | 'AA') => CRITERIA.filter((c) => c.level === level).map((c) => `| ${c.id} ${c.name} | ${c.status} | ${c.remarks.replace(/\|/g, '\\|')} |`).join('\n');
  return [
    `**${REPORT.product} ${REPORT.version}** · ${REPORT.date}`,
    '',
    `**Scope.** ${REPORT.scope}`,
    '',
    `**How it was checked.** ${REPORT.method}`,
    '',
    `**Summary.** ${CRITERIA.length} criteria: ${t.Supports} supported, ${t['Partially supports']} partly, ${t['Does not support']} not supported, ${t['Not applicable']} not applicable.`,
    '',
    '### Level A',
    '',
    '| Criterion | Conformance | Remarks |',
    '| --- | --- | --- |',
    rows('A'),
    '',
    '### Level AA',
    '',
    '| Criterion | Conformance | Remarks |',
    '| --- | --- | --- |',
    rows('AA'),
    '',
  ].join('\n');
}
