# Keeper by Ashforde® — Privacy browser extension

Optional. It tells the Keeper app which other sites (third parties, trackers) each page you visit loads, so Privacy & Security → Connections can show them per site, and it lets you control tabs and sites from Keeper's **Browser tabs** page: mute, sleep, show or close a tab, per-site camera, microphone, location, notifications, JavaScript and cookies (Chromium browsers), tracker blocking from Keeper's blocklists (declarativeNetRequest rules), clearing a site's data, blocking third-party cookies and sending chosen sites through a proxy. It never reads page contents or what you type. Everything goes to and from the Keeper app on this computer through native messaging, never to the internet; Keeper checks every command before sending it.

It needs access to all sites, because that is the only way to see requests, and the permissions for the controls above (`declarativeNetRequest`, `contentSettings`, `browsingData`, `cookies`, `proxy`, `privacy`). Version 0.2.0 added those; the browser asks once when it updates. That is exactly the kind of broad access Keeper warns about for other extensions, so install it only if you want per-site reports.

## Install

1. In Keeper, open Privacy & Security → Browsers and press **Connect browsers**. That registers Keeper with each installed browser.
2. Chromium browsers (Chrome, Edge, Brave, Vivaldi, Opera, Arc): open the extensions page, turn on Developer mode, choose **Load unpacked** and pick this folder. Its id is always `lkgnaaiefeiflokcnjnpmocahliakgac`.
3. Firefox: copy `manifest.firefox.json` over `manifest.json` in a copy of this folder, then open `about:debugging` → This Firefox → **Load Temporary Add-on**. A signed add-on is needed for permanent installation.
4. Safari is not supported: it does not allow native messaging to apps outside the App Store.

## Cues

Version 0.3.0 adds Keeper's cues: notes and checklists tied to a page or a site that pop up when you come back to it. The toolbar button (or Alt+Shift+K, or the page's right-click menu) leaves a cue for the page or the whole site, and the extension tells Keeper which page is in front when it changes so cues can show beside it. Only the page's address and title go to Keeper on this computer. It needs the `contextMenus` permission for the right-click entries.
