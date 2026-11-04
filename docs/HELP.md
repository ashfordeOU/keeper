# Help on every page

The **?** in the top bar (or **F1**, or **Help for This Page** in the command palette) opens a sheet about the page you are on:

1. **What this is**, in one line.
2. **Here you can**: the three things people do there most.
3. **The guide**: that page's own guide from Keeper's documentation, shown in the sheet.

The guides are bundled with Keeper, so help works with no internet. A link to another guide opens it in the same sheet (**Back** returns). A web link opens in your browser. Pictures in the guides are left out of the sheet.

A tab with a guide of its own gets it: Network & firewall, Network activity and VPN under Privacy & Security, and Private network under Devices. Other tabs show their page's help.

**Settings → General → Show the Help button** hides the **?**. F1 and the palette still work.

## For developers

- `core/help.ts`: `PAGE_HELP` (what, three things, the guide) for every page in `core/nav.ts`, `helpFor(route)` and `cleanDoc()`. `test/help.test.ts` checks that every page has help, that each line is short and plain, and that every guide it names exists.
- `src/components/HelpSheet.tsx`: the button, F1 and the sheet. Each guide is its own small chunk of the build (`import.meta.glob('../../docs/*.md', { query: '?raw' })`), loaded the first time it is opened.
- When you add a page to `core/nav.ts`, add its line to `PAGE_HELP`; the test fails until you do.
