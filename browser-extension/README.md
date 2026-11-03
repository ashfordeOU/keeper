# Keeper by Ashforde® — Privacy browser extension

Optional. It tells the Keeper app which other sites (third parties, trackers) each page you visit loads, so Privacy & Security → Connections can show them per site, and it lets you control tabs and sites from Keeper's **Browser tabs** page: mute, sleep, show or close a tab, per-site camera, microphone, location, notifications, JavaScript and cookies (Chromium browsers), tracker blocking from Keeper's blocklists (declarativeNetRequest rules), clearing a site's data, blocking third-party cookies and sending chosen sites through a proxy. It never reads page contents or what you type. Everything goes to and from the Keeper app on this computer through native messaging, never to the internet; Keeper checks every command before sending it.

It needs access to all sites, because that is the only way to see requests, and the permissions for the controls above (`declarativeNetRequest`, `contentSettings`, `browsingData`, `cookies`, `proxy`, `privacy`). Version 0.2.0 added those; the browser asks once when it updates. That is exactly the kind of broad access Keeper warns about for other extensions, so install it only if you want per-site reports.

## Install

Keeper does every step a browser allows an app to do:

1. **Registration is automatic.** While Browser tab controls are on, Keeper finds the browsers on the computer (Chrome, Chromium, Edge, Brave, Vivaldi, Opera, Arc, Firefox) and registers itself with each one (native messaging host manifests; registry keys on Windows), again whenever a new browser appears. Browser tabs → ⋯ → **Re-link browsers** does it once more by hand.
2. **Adding the extension is the person's click.** Browsers do not let an app install an extension by itself except through company policies, which Keeper does not use. Browser tabs shows each browser found with a big **Add to …** button:
   - If the extension's store page is set in `STORE_LISTINGS` (`core/browser-setup.ts`), the button opens that page in that browser and adding it is one click.
   - Otherwise it opens the browser's extensions page (`chrome://extensions`, `edge://extensions`, `brave://extensions`…), shows the extension's folder and copies its path, and walks through three steps: turn on Developer mode, click **Load unpacked**, choose the folder. Keeper keeps a copy of the extension in its own data folder (on a Mac `~/Library/Application Support/Keeper/browser-extension`), refreshed on every update, because the copy inside the app is hard to reach in a file dialog. The extension's id is always `lkgnaaiefeiflokcnjnpmocahliakgac`.
   - Firefox: it opens `about:debugging#/runtime/this-firefox`; **Load Temporary Add-on…** and choose `manifest.json` in `browser-extension-firefox` (Keeper's copy with the Firefox manifest). Firefox forgets temporary add-ons when it quits; a signed add-on is needed to keep it.
3. The page checks only while the setup is on screen and switches to the tabs by itself once the extension connects.

Safari is not supported yet.

**TODO (publishing):** publish the extension on the Chrome Web Store (it also installs in Edge, Brave, Vivaldi, Opera and Arc), on Microsoft Edge Add-ons and on Firefox Add-ons (addons.mozilla.org, which also signs it so Firefox keeps it), then put the listing addresses in `STORE_LISTINGS` in `core/browser-setup.ts`. "Add to Chrome" then opens the store page and adding Keeper's extension is one click, with automatic updates from the store. Keep the store build's key so its id stays the one in the native messaging manifest, or add the store id to `hostManifest`'s allowed origins.

## Focus blocking

Version 0.4.0 shows Keeper's block page while Keeper blocks sites for Focus (Keeper's Focus Blocking page). Keeper sends the list of sites; the extension sends pages on them to its own `blocked.html` (a page inside the extension, listed in `web_accessible_resources`) and moves tabs already open there. "Let me in" asks Keeper, which decides; in strict mode there is no such button. The block is kept in the extension's storage and ends at its time even when Keeper is not running. Nothing about the pages you visit is sent for this.

## Save for later

The page's right-click menu (and a link's) has **Save for later in Keeper**: the extension sends the page's address and title to Keeper, which fetches the page itself and keeps a clean copy in its Reader (Read later).

## Cues

Version 0.3.0 adds Keeper's cues: notes and checklists tied to a page or a site that pop up when you come back to it. The toolbar button (or Alt+Shift+K, or the page's right-click menu) leaves a cue for the page or the whole site, and the extension tells Keeper which page is in front when it changes so cues can show beside it. Only the page's address and title go to Keeper on this computer. It needs the `contextMenus` permission for the right-click entries.
