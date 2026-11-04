# The visual budget

Keeper aims to be calm: one clear main action per screen, the essentials in view and
the rest one click away. The visual budget turns that into numbers a test can check, so
no page drifts into a wall of icons or tabs as features are added.

## The rules (core/design-budget.ts)

| Rule | Budget | What a page does instead |
| --- | --- | --- |
| Tabs in view in one row | at most 6 | The rest go under **More** at the end of the row (`Tabs` in `src/components/Tabs.tsx` does this for every page; put the most used tabs first). |
| Icon-only buttons in one toolbar row | at most 5, each with a label or tooltip | Put the rest in a **More** (⋯) menu, or give buttons words. |
| Filled (primary) buttons on a screen | at most 1 | Other actions are plain or ghost buttons; repeated row actions (Connect, Fix) are never filled. |
| Words cut by an ellipsis | never inside a word | Shorter labels and placeholders ("Search everything", "Add cloud or server…"). File and folder names are people's own words and may be cut. |
| Raw paths and temporary folders | none on screen | `friendlyPath()` and `friendlyPathsIn()` in `core/format.ts` name folders the way people do ("Documents › Work", "Home"); the full path goes in the tooltip. |
| Page titles | at most 4 words | Checked for every page, tab and Settings section name. |
| "No … yet" lines | only inside the designed empty state | `Empty` in `src/components/ui.tsx`: a small picture, a short title, one line, the one useful action and a hint. |

## The test

`test/e2e/design-budget.cjs` starts the real app with every part switched on, opens every
sidebar page, every tab of the merged pages and every Settings section at 1440×900 and
1024×768, measures what is on screen and checks it against the rules. It writes
`budget-report.txt` and `budget-report.json` (per page: title, tabs, icon buttons, filled
buttons, problems) and a picture of each page over budget. CI runs it on Linux and keeps
the report as an artifact; it fails when any page goes over.

Run it yourself:

```sh
KEEPER_SKIP_TOUR=1 xvfb-run -a -s "-screen 0 1440x900x24" node test/e2e/design-budget.cjs /tmp/kdb /tmp/kdb-shots
BUDGET_ONLY=agents,security BUDGET_SIZES=1440x900 …   # some pages, one size
BUDGET_SHOTS=all …                                      # a picture of every page
```

Marking text as people's own (file names, place names) with `data-user-text` keeps it out
of the truncation check; nothing else should need an exception.

## The window's frame

- The top bar has no bare icons: **Info** (the Inspector, on file pages) and **View** (open
  this page in a new window, the command palette, the theme and light or dark).
- The search box says "Search everything"; examples of plain-English searches appear under
  it while it is empty and focused.
