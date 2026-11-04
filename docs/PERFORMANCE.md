<!-- SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0 -->
# Performance budgets

Keeper promises to stay light. Each part has a budget, the build fails when one is broken, and people can see what each part uses now.

## What you see

- **Settings → Battery and speed → What each part uses**: "Keeper is using 410 MB", then each running part (the main process, windows, the Island, Mail, graphics, helpers) with its memory and processor use now, and whether it is within its budget ("Over its 250 MB" in amber when not). Parts that can be switched off have **Turn off**; **Restart or stop a part** opens Keeper itself on the Health page. It is read every three seconds, only while shown.
- **Settings → About**: "Keeper is using 410 MB" next to the version, one click from the breakdown.

## The budgets

All in `core/perf-budgets.json`, read by the app and by the build.

| Target | Budget |
| --- | --- |
| Cold start to the first page | 2 s on a mid laptop |
| Idle processor, all of Keeper | 0.5% of one core (the build allows 0.6% for a busy machine) |
| Idle main process with Recommended | 250 MB |
| Wakeups | 1 per second in total |

Live budgets (the system's working set, as Settings shows it): main process 300 MB, a window 250 MB, graphics 250 MB, the Island's process 250 MB, Mail's 200 MB, widgets 180 MB, any other service 200 MB, a helper 150 MB; processor 1 to 2% each while idle.

Build budgets per part (memory Keeper allocates itself, steadier between machines), checked by `test/e2e/perf-budget.cjs` on Linux after a minute of doing nothing with 2,000 files: main 115 MB, windows 85, the Island 140, Mail 50, widgets 80, graphics 50, helpers 50. Measured on 4 November 2026: 80, 58, 104, 31, –, 30 and 32 MB. The run logs each part against its budget and fails if one is over, as well as the totals it already checked.

## Measured by hand

Mac and Windows are measured by hand each release (Activity Monitor, Task Manager) against the same live budgets: the build machines' numbers are Linux only. Cold start and wakeups are measured by hand on all three for now.

## For developers

- Budgets, plain names for helpers, the rows and lines: `core/perf-budgets.ts` (tests in `test/perf-budgets.test.ts`).
- The panel and the About line: `src/components/PartsCost.tsx`. End to end: `test/e2e/reach.cjs perf`.
