// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Keeper by Ashforde® — Privacy extension.
// Watches which other sites each page loads and sends a short summary per site
// to the Keeper app on this computer through native messaging, and carries out
// the tab and site controls the person chooses in Keeper (see "tab controls").
// Nothing is sent anywhere else, and page contents and form data are never read.

const api = globalThis.browser ?? globalThis.chrome;
const HOST = 'org.ashforde.keeper';

/** Last two labels, or three for common two-part endings (co.uk, com.au…): close enough to tell first from third parties. */
function site(host) {
  const p = host.toLowerCase().replace(/\.$/, '').split('.');
  if (p.length <= 2) return p.join('.');
  const two = p.slice(-2).join('.');
  return /^(co|com|org|net|gov|ac|edu)\.[a-z]{2}$/.test(two) ? p.slice(-3).join('.') : two;
}

/** tabId → { site, parties: Map<host, count> } */
const tabs = new Map();

api.webRequest.onCompleted.addListener(
  (d) => {
    if (d.tabId < 0) return;
    let url;
    try {
      url = new URL(d.url);
    } catch {
      return;
    }
    if (d.type === 'main_frame') {
      flush(d.tabId);
      tabs.set(d.tabId, { site: site(url.hostname), parties: new Map() });
      return;
    }
    const t = tabs.get(d.tabId);
    if (!t || !/^https?:$/.test(url.protocol)) return;
    if (site(url.hostname) === t.site) return;
    t.parties.set(url.hostname, (t.parties.get(url.hostname) ?? 0) + 1);
  },
  { urls: ['<all_urls>'] },
);

api.tabs.onRemoved.addListener((id) => flush(id));

function send(msg) {
  // One link to Keeper carries page reports and tab controls (see below).
  try {
    linkToKeeper()?.postMessage(msg);
  } catch {
    /* Keeper is not running */
  }
}

function flush(tabId) {
  const t = tabs.get(tabId);
  tabs.delete(tabId);
  if (!t || !t.parties.size) return;
  send({ site: t.site, thirdParties: [...t.parties].slice(0, 200).map(([host, requests]) => ({ host, requests })), at: Date.now(), browser: navigator.userAgent.match(/(Firefox|Edg|OPR|Brave|Vivaldi|Chrome)\/[\d.]+/)?.[0] });
}

// Long-lived pages report every few minutes too.
setInterval(() => {
  for (const id of [...tabs.keys()]) {
    const t = tabs.get(id);
    if (t && t.parties.size) {
      flush(id);
      tabs.set(id, { site: t.site, parties: new Map() });
    }
  }
}, 5 * 60_000);

// ---------------------------------------------------------------- tab controls
// The link to Keeper both ways: open tabs go to the Keeper app on this
// computer, and Keeper sends back what the person chose there (mute, sleep a
// tab, site permissions, blocking rules, per-site proxy). Every command is
// checked by Keeper before it is sent; this side only does what the browser's
// own extension APIs allow.

const isFirefox = typeof globalThis.browser !== 'undefined' && /Firefox/.test(navigator.userAgent);
// Brave, Opera and Edge also name themselves in the client hints; Brave's user agent says only "Chrome".
const brandName = () => {
  const brands = (navigator.userAgentData?.brands ?? []).map((b) => b.brand);
  const ver = navigator.userAgent.match(/Chrome\/(\d+)/)?.[1] ?? '';
  if (navigator.brave || brands.includes('Brave')) return `Brave ${ver}`;
  const named = [['Microsoft Edge', 'Edge'], ['Opera', 'Opera'], ['Vivaldi', 'Vivaldi']].find(([b]) => brands.includes(b));
  return named ? `${named[1]} ${ver}` : null;
};
const browserName = () => brandName() ?? navigator.userAgent.match(/(Firefox|Edg|OPR|Brave|Vivaldi|Chrome)\/(\d+)/)?.slice(1).join(' ').replace('Edg', 'Edge').replace('OPR', 'Opera') ?? 'Browser';
const caps = () => ['tabs', 'mute', 'discard', ...(api.contentSettings ? ['contentSettings'] : []), ...(api.declarativeNetRequest ? ['dnr'] : []), ...(api.browsingData ? ['cookies'] : []), ...(api.proxy ? ['proxy'] : []), ...(api.declarativeNetRequest ? ['focus'] : [])];

/** tabId → { bytes, requests, parties: Map<host, {requests, blocked}> } since the page loaded */
const usage = new Map();
const SITE_RULE_BASE = 900000;

api.webRequest.onCompleted.addListener(
  (d) => {
    if (d.tabId < 0) return;
    if (d.type === 'main_frame') usage.set(d.tabId, { bytes: 0, requests: 0, parties: new Map() });
    const u = usage.get(d.tabId) ?? { bytes: 0, requests: 0, parties: new Map() };
    u.requests++;
    const len = Number((d.responseHeaders ?? []).find((h) => h.name.toLowerCase() === 'content-length')?.value ?? 0);
    u.bytes += Number.isFinite(len) ? len : 0;
    usage.set(d.tabId, u);
  },
  { urls: ['<all_urls>'] },
  ['responseHeaders'],
);
api.webRequest.onErrorOccurred?.addListener(
  (d) => {
    if (d.tabId < 0 || !/BLOCKED_BY_CLIENT|NS_ERROR_ABORT/.test(d.error ?? '')) return;
    const u = usage.get(d.tabId);
    if (!u) return;
    try {
      const host = new URL(d.url).hostname;
      const p = u.parties.get(host) ?? { requests: 0, blocked: 0 };
      p.blocked++;
      u.parties.set(host, p);
    } catch { /* ignore */ }
  },
  { urls: ['<all_urls>'] },
);
api.tabs.onRemoved.addListener((id) => usage.delete(id));

function partiesOf(tabId) {
  const t = tabs.get(tabId);
  const u = usage.get(tabId);
  const out = new Map();
  for (const [host, requests] of t?.parties ?? []) out.set(host, { host, requests, blocked: 0 });
  for (const [host, p] of u?.parties ?? []) out.set(host, { ...(out.get(host) ?? { host, requests: 0 }), blocked: p.blocked });
  return [...out.values()].sort((a, b) => b.requests - a.requests).slice(0, 100);
}

async function allTabs() {
  const list = await api.tabs.query({});
  return list.filter((t) => t.id !== undefined).map((t) => ({
    id: t.id, windowId: t.windowId, url: t.url ?? '', title: t.title ?? '', active: !!t.active, audible: !!t.audible,
    muted: !!t.mutedInfo?.muted, discarded: !!t.discarded, incognito: !!t.incognito,
    bytes: usage.get(t.id)?.bytes, requests: usage.get(t.id)?.requests, parties: partiesOf(t.id).slice(0, 30),
  }));
}

let link;
function linkToKeeper() {
  if (link) return link;
  try {
    link = api.runtime.connectNative(HOST);
  } catch {
    return undefined;
  }
  link.onDisconnect.addListener(() => {
    link = undefined;
    // Keeper may not be installed or running; try again later, never in a tight loop.
    setTimeout(linkToKeeper, 60_000);
  });
  link.onMessage.addListener((m) => {
    if (m && m.kind === 'cmd') void run(m.reqId, m.command);
    else if (m && m.kind === 'focusPassResult') passAnswered(m);
  });
  link.postMessage({ kind: 'hello', browser: browserName(), version: api.runtime.getManifest().version, caps: caps() });
  void sendTabs();
  return link;
}

let tabsTimer;
async function sendTabs() {
  if (!link) return;
  try {
    link.postMessage({ kind: 'tabs', tabs: await allTabs() });
  } catch { /* the link closed */ }
}
const tabsChanged = () => {
  clearTimeout(tabsTimer);
  tabsTimer = setTimeout(sendTabs, 1000);
};
for (const ev of ['onCreated', 'onRemoved', 'onUpdated', 'onActivated', 'onReplaced']) api.tabs[ev]?.addListener(tabsChanged);

async function contentClear(type, keep) {
  // contentSettings cannot remove one pattern: clear Keeper's rules for the type and put the others back.
  await api.contentSettings[type].clear({});
  for (const [pattern, setting] of Object.entries(keep)) await api.contentSettings[type].set({ primaryPattern: pattern, setting });
}

async function run(reqId, c) {
  const reply = (ok, result, error) => { try { link?.postMessage({ kind: 'reply', reqId, ok, result, error }); } catch { /* closed */ } };
  try {
    let result;
    switch (c?.cmd) {
      case 'list': result = await allTabs(); break;
      case 'mute': await api.tabs.update(c.tabId, { muted: !!c.muted }); break;
      case 'discard': await api.tabs.discard(c.tabId); break;
      case 'close': await api.tabs.remove(c.tabId); break;
      case 'reload': await api.tabs.reload(c.tabId); break;
      case 'focus': {
        const t = await api.tabs.update(c.tabId, { active: true });
        await api.windows.update(t.windowId, { focused: true });
        break;
      }
      case 'tabInfo': {
        const t = await api.tabs.get(c.tabId);
        result = { id: t.id, url: t.url, title: t.title, bytes: usage.get(t.id)?.bytes ?? 0, requests: usage.get(t.id)?.requests ?? 0, parties: partiesOf(t.id) };
        break;
      }
      case 'contentSetting': {
        if (!api.contentSettings) throw new Error(`${browserName()} does not let extensions change site permissions; use the browser's own site settings.`);
        const key = `cs:${c.type}`;
        const saved = (await api.storage.local.get(key))[key] ?? {};
        if (c.setting === 'default') {
          delete saved[c.pattern];
          await contentClear(c.type, saved);
        } else {
          saved[c.pattern] = c.setting;
          await api.contentSettings[c.type].set({ primaryPattern: c.pattern, setting: c.setting });
        }
        await api.storage.local.set({ [key]: saved });
        break;
      }
      case 'getContentSettings': {
        result = {};
        if (api.contentSettings) {
          for (const t of ['camera', 'microphone', 'location', 'notifications', 'javascript', 'cookies', 'popups', 'images', 'sound', 'automaticDownloads']) {
            try { result[t] = (await api.contentSettings[t].get({ primaryUrl: c.url })).setting; } catch { /* not supported here */ }
          }
        }
        break;
      }
      case 'clearSiteData': {
        const what = {};
        for (const w of c.what) what[w] = true;
        await api.browsingData.remove({ origins: [c.origin] }, what);
        break;
      }
      case 'thirdPartyCookies':
        await api.privacy.websites.thirdPartyCookiesAllowed.set({ value: !c.block });
        break;
      case 'setBlockRules': {
        const old = await api.declarativeNetRequest.getDynamicRules();
        await api.declarativeNetRequest.updateDynamicRules({ removeRuleIds: old.filter((r) => r.id < SITE_RULE_BASE).map((r) => r.id), addRules: c.rules });
        result = { rules: c.rules.length };
        break;
      }
      case 'setSiteBlocking': {
        // Blocking off for a site = a higher-priority allow rule for pages on it.
        const host = c.site.replace(/^\*\./, '').toLowerCase();
        let h = 0;
        for (const ch of host) h = (h * 31 + ch.charCodeAt(0)) % 90000;
        const id = SITE_RULE_BASE + h;
        await api.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [id], addRules: c.on ? [] : [{ id, priority: 3, action: { type: 'allowAllRequests' }, condition: { requestDomains: [host], resourceTypes: ['main_frame', 'sub_frame'] } }] });
        break;
      }
      case 'setFocusBlock':
        await applyFocusBlock(c);
        result = { sites: c.sites.length };
        break;
      case 'setProxy':
        if (c.pac === null) await api.proxy.settings.clear({});
        else if (isFirefox) await api.proxy.settings.set({ value: { proxyType: 'autoConfig', autoConfigUrl: `data:application/x-ns-proxy-autoconfig,${encodeURIComponent(c.pac)}` } });
        else await api.proxy.settings.set({ value: { mode: 'pac_script', pacScript: { data: c.pac } }, scope: 'regular' });
        break;
      default:
        throw new Error('Unknown command');
    }
    reply(true, result);
  } catch (e) {
    reply(false, undefined, e instanceof Error ? e.message : String(e));
  }
}

linkToKeeper();

// ---------------------------------------------------------------- Focus blocking
// While Keeper blocks sites for Focus, pages on them open the extension's own
// block page (blocked.html) instead. The block is kept in the extension's
// storage so it survives the browser restarting, and it ends by itself at its
// time even if Keeper is not running then. "Let me in" asks Keeper, which
// decides (no short visits in strict mode).

const FOCUS_BASE = 990001;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const blockPage = () => api.runtime.getURL('blocked.html');
let focusTimer;

async function applyFocusBlock(b) {
  const live = b && (!b.until || b.until > Date.now()) ? b.sites.slice(0, 1000) : [];
  await api.storage.local.set({ focusBlock: live.length ? b : null });
  const old = await api.declarativeNetRequest.getDynamicRules();
  const addRules = live.map((site, i) => ({
    id: FOCUS_BASE + i,
    priority: 10,
    action: { type: 'redirect', redirect: { regexSubstitution: `${blockPage()}?site=${site}&u=\\0` } },
    condition: { regexFilter: `^https?://([^/?#]*\\.)?${escapeRe(site)}(:[0-9]+)?([/?#].*)?$`, resourceTypes: ['main_frame'] },
  }));
  await api.declarativeNetRequest.updateDynamicRules({ removeRuleIds: old.filter((r) => r.id >= FOCUS_BASE).map((r) => r.id), addRules });
  clearTimeout(focusTimer);
  if (live.length && b.until) focusTimer = setTimeout(() => void applyFocusBlock(null), Math.min(b.until - Date.now() + 500, 2 ** 31 - 1));
  // Pages already open on a blocked site move to the block page too.
  if (!live.length) return;
  for (const t of await api.tabs.query({})) {
    try {
      if (!/^https?:/.test(t.url ?? '')) continue;
      const h = new URL(t.url).hostname.toLowerCase();
      const s = live.find((x) => h === x || h.endsWith(`.${x}`));
      if (s) await api.tabs.update(t.id, { url: `${blockPage()}?site=${s}&u=${t.url}` });
    } catch { /* the tab went away */ }
  }
}

// A block whose time passed while the browser was closed ends now.
void api.storage.local.get('focusBlock').then((r) => {
  const b = r.focusBlock;
  if (b) void applyFocusBlock(b);
}).catch(() => undefined);

const passes = new Map();
function passAnswered(m) {
  const p = passes.get(m.reqId);
  if (!p) return;
  passes.delete(m.reqId);
  clearTimeout(p.timer);
  p.resolve({ ok: !!m.ok, message: m.message });
}

async function askPass(site) {
  const l = linkToKeeper();
  if (!l) return { ok: false, message: 'Keeper is not running, so it cannot let you in.' };
  const reqId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const answer = await new Promise((resolve) => {
    const timer = setTimeout(() => { passes.delete(reqId); resolve({ ok: false, message: 'Keeper did not answer. Is it running?' }); }, 8000);
    passes.set(reqId, { resolve, timer });
    try { l.postMessage({ kind: 'focusPass', site, reqId }); } catch { clearTimeout(timer); passes.delete(reqId); resolve({ ok: false, message: 'Keeper is not running.' }); }
  });
  if (answer.ok) {
    // Let the page through straight away; Keeper sends the updated block (and takes the pass back when it ends).
    const b = (await api.storage.local.get('focusBlock')).focusBlock;
    if (b) await applyFocusBlock({ ...b, sites: b.sites.filter((s) => s !== site) });
  }
  return answer;
}

api.runtime.onMessage.addListener((m, sender, reply) => {
  if (!m || m.kind !== 'focusPass' || sender.id !== api.runtime.id) return undefined;
  void askPass(String(m.site ?? '')).then(reply);
  return true;
});

// ---------------------------------------------------------------- cues
// Keeper's cues (notes and checklists tied to a page or site) pop up when the
// page they belong to is in front, so Keeper is told which page that is when
// it changes. The toolbar button, its shortcut and the page's right-click menu
// leave a cue for the page. Only the address and title are sent, to Keeper on
// this computer.

let lastActive = '';
async function reportActive() {
  if (!link) return;
  try {
    const [t] = await api.tabs.query({ active: true, lastFocusedWindow: true });
    if (!t || !/^https?:/.test(t.url ?? '')) return;
    const key = `${t.url}\u0000${t.title}`;
    if (key === lastActive) return;
    lastActive = key;
    link.postMessage({ kind: 'active', url: t.url, title: t.title ?? '' });
  } catch { /* the link closed */ }
}
api.tabs.onActivated?.addListener(() => void reportActive());
api.tabs.onUpdated?.addListener((_id, info, tab) => { if (tab.active && (info.url || info.title || info.status === 'complete')) void reportActive(); });
api.windows?.onFocusChanged?.addListener((w) => { if (w !== api.windows.WINDOW_ID_NONE) { lastActive = ''; void reportActive(); } });

function leaveCue(tab, site, text) {
  if (!tab || !/^https?:/.test(tab.url ?? '')) return;
  const l = linkToKeeper();
  if (!l) return;
  try { l.postMessage({ kind: 'cue', url: tab.url, title: tab.title ?? '', site: !!site, text: text ?? '' }); } catch { /* Keeper is not running */ }
  // A small tick on the button says it was saved.
  try { api.action?.setBadgeText({ tabId: tab.id, text: '✓' }); setTimeout(() => api.action?.setBadgeText({ tabId: tab.id, text: '' }), 1500); } catch { /* no badge here */ }
}
api.action?.onClicked?.addListener((tab) => leaveCue(tab, false));
api.commands?.onCommand?.addListener(async (cmd) => {
  if (cmd !== 'keeper-cue') return;
  const [t] = await api.tabs.query({ active: true, lastFocusedWindow: true });
  leaveCue(t, false);
});
if (api.contextMenus) {
  api.runtime.onInstalled?.addListener(() => {
    try {
      api.contextMenus.create({ id: 'keeper-cue-page', title: 'Leave a Keeper cue for this page', contexts: ['page', 'link', 'selection'] });
      api.contextMenus.create({ id: 'keeper-cue-site', title: 'Leave a Keeper cue for this site', contexts: ['page'] });
    } catch { /* already there */ }
  });
  api.contextMenus.onClicked.addListener((info, tab) => {
    const target = info.linkUrl ? { ...tab, url: info.linkUrl, title: info.selectionText || info.linkUrl } : tab;
    leaveCue(target, info.menuItemId === 'keeper-cue-site', info.selectionText);
  });
}
