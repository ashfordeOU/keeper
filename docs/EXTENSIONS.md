<!-- SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0 -->
# Extensions

Extensions are small add-ons that bring their own commands to the command palette. Turn them on in **Settings → Features → Extensions** (off until you do), then **Settings → General → Extensions → Install from a folder…**.

## Safe by design

- **Each runs on its own**, in a worker made from a `data:` address: an origin of its own (none of Keeper's storage), no window, no Node, no `require`, and no network of its own (Keeper's content policy allows none). The only way out is the `keeper` object, which sends messages.
- **Every message is checked** against the extension's permissions. Before installing, Keeper says what it may do in plain words. Each permission is **Off**, **Ask** (the default: Keeper asks each time, with *Allow once*, *Always allow* and *Don't allow*) or **Allow**, the same three choices as AI agents.
- **What it may do** (v1): show you short messages (`notify`), see the names of files that match its searches (`search`), put text on your clipboard (`clipboard`), add things to your Inbox (`inbox`), and reach the sites it lists, over https only (`network` with `hosts`). It cannot read your files.
- **Fingerprinted**: Keeper fingerprints the folder (SHA-256 of every file's name and contents) when it is installed, and refuses to run it if a file changes afterwards. Installing with an expected fingerprint (as a curated list will) refuses any other folder.
- **Off costs nothing**: nothing is read or run until one of its commands is used; then its worker runs until Keeper closes or the list changes.

## Making one

A folder with `manifest.json` and one script. The example is in [`docs/extensions/hello`](extensions/hello):

```json
{
  "id": "example.hello",
  "name": "Hello",
  "version": "1.0.0",
  "surfaces": ["commands"],
  "main": "main.js",
  "commands": [{ "id": "hello", "title": "Say hello" }],
  "permissions": ["notify", "inbox"]
}
```

```js
keeper.onCommand('hello', async () => {
  await keeper.notify('Hello from an extension');
});
```

The script has `keeper.onCommand(id, fn)`, `keeper.notify(text)`, `keeper.search(words)` (file names), `keeper.copy(text)`, `keeper.catch(text)` (into the Inbox) and `keeper.fetch(url)` (`{ status, text }`, listed sites only). Each returns a promise that fails with a plain message when the permission is Off or the person says no.

## What comes later

The manifest already names the other places an extension will be able to appear (`today-cards`, `island-cards`, `automation-steps`, `notes-renderers`). This Keeper refuses those plainly until they arrive. Installing from a web address with a checksum, and a curated list, come with them.

## For developers

- Manifest rules, permissions in words, fingerprints, sites and the worker's script: `core/extensions.ts` (tests in `test/extensions.test.ts`).
- Installing, permissions and the calls that need the main process (search, sites): `electron/services/extensions.ts`.
- The panel, the palette commands and the host that runs workers and asks: `src/components/Extensions.tsx`. End to end: `test/e2e/reach.cjs extensions`.
