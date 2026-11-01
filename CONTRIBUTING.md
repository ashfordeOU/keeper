# Contributing to Keeper

Thank you for helping. Keeper by Ashforde® is made by Ashforde OÜ and is source-available under the [PolyForm Shield License 1.0.0](LICENSE.md). Before you send a pull request, please read the [contributor terms](#contributor-terms) below.

## Getting started

```bash
git clone https://github.com/ashfordeOU/keeper.git
cd keeper
npm install
npm run demo     # interface only, sample data, in the browser
npm run dev      # the full desktop app with hot reload
npm test
```

## Ground rules

1. **Nothing may cost a user a file.** Anything the user made goes to the system Trash. Only rebuildable caches are deleted, and only from locations defined in `core/cleanup/targets.ts`. Every destructive path goes through `core/safety.ts` and is recorded in the history (`core/journal.ts`).
2. **Never decide what to remove from a path the interface sends.** The main process re-derives targets from its own scan results.
3. **Files stay on the computer.** New network calls need a clear user-facing reason, must be optional, and must be listed under *Privacy* in the README.
4. **Keep `core/` free of Electron.** The engine is shared with the CLI and tested with plain Node. Platform specifics live in `electron/services/` (or in `core/platform.ts` when the CLI needs them too).
5. **Test engine changes.** Add or update tests in `test/` for anything in `core/` — especially the search parser, which has many small behaviours.
6. **Write for people.** Interface copy is short, plain and friendly: “Moved 3 items to the Trash”, not “Operation completed successfully”.
7. **Work on all three systems.** If a feature cannot work on one OS, degrade gracefully and note it in the README's platform table.

## Code style

- TypeScript, strict mode, 2-space indent, single quotes.
- Each file starts with `// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0` and a short comment saying what the file is for.
- Comments explain *why*, not *what*.
- Run `npm run typecheck && npm test` before opening a pull request.

## Adding things

- **A cleanup location** — add it to the right platform in `core/cleanup/targets.ts` with an honest description and safety level (`safe` only if the app truly rebuilds it without the user noticing).
- **A download source** — add the hosts to `KNOWN_SOURCES` in `core/sources.ts` and an alias in `sourceFromWord`.
- **A search phrase** — extend `core/query/parse.ts` and add a case to `test/parse.test.ts`.
- **A toolbox tool** — pure helpers go in `core/textools.ts` (with tests); the card goes in `src/screens/Tools.tsx`.
- **An IPC call** — add it to `core/api.ts`, `electron/preload.ts`, `electron/main.ts` and the demo data in `src/mock.ts`.

## Contributor terms

<!-- To be reviewed by a lawyer before the first outside contribution is merged. -->

Keeper is free to use and its code is public, and Ashforde OÜ also offers commercial licences. To keep both possible, every contribution comes with these terms:

- **You keep your copyright.** Your work stays yours.
- **You give Ashforde OÜ a licence to it.** By sending a contribution (code, documentation, translations, artwork or anything else), you grant Ashforde OÜ a perpetual, worldwide, royalty-free, irrevocable licence to use, copy, change, publish, distribute, sublicense and relicense your contribution, under the PolyForm Shield License 1.0.0, under commercial terms or under any other licence.
- **You have the right to send it.** You confirm the contribution is your own work, or that you have the right to submit it under these terms, and that it does not knowingly include anyone else's code under incompatible terms. If your employer has rights in your work, make sure they agree.

To confirm, tick **"I agree to CONTRIBUTING.md"** in your pull request. If you do not want to agree, open an issue to describe the change instead, and we will write it ourselves.

## Reporting bugs

Open an issue with your OS and version, what you did, what you expected and what happened. Screenshots help. Please do not include personal file names you would rather keep private.

## Conduct

Be kind and assume good faith. Harassment of any kind is not tolerated in issues, pull requests or discussions.
