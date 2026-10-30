// SPDX-License-Identifier: AGPL-3.0-or-later
// Exposes the KeeperApi to the interface. Every call is a named IPC message;
// the renderer never gets Node or Electron access of its own.

import { contextBridge, ipcRenderer, webUtils } from 'electron';

const invoke = (ch: string) => (...args: unknown[]) => ipcRenderer.invoke(ch, ...args);

function group(name: string, methods: string[]) {
  return Object.fromEntries(methods.map((m) => [m, invoke(`${name}.${m}`)]));
}

const api = {
  system: group('system', ['info', 'disks', 'health', 'killProcess', 'ejectAll', 'wifiNetworks', 'openExternal']),
  capture: group('capture', ['text', 'clipboardImage']),
  weather: group('weather', ['get', 'search']),
  settings: group('settings', ['get', 'set', 'setSecret', 'hasSecret', 'pickFolder']),
  library: group('library', ['status', 'rescan', 'totals', 'recent', 'list', 'search', 'bySource', 'tags', 'setTags', 'inspect', 'readText', 'largeFiles']),
  files: {
    ...group('files', ['browse', 'thumbnail', 'icon', 'open', 'openWith', 'reveal', 'copyPaths', 'copyText', 'trash', 'move', 'copy', 'rename', 'previewRename', 'applyRename', 'newFolder', 'compress']),
    startDrag: (paths: string[]) => ipcRenderer.send('files.startDrag', paths),
    /** the real path of a File dropped from the OS */
    pathOf: (file: File) => webUtils.getPathForFile(file),
  },
  duplicates: group('duplicates', ['scan']),
  cleanup: group('cleanup', ['scan', 'clean']),
  space: group('space', ['tree']),
  startup: group('startup', ['list', 'toggle']),
  apps: group('apps', ['list', 'uninstall']),
  protection: group('protection', ['check']),
  rules: group('rules', ['list', 'save', 'remove', 'plan', 'run']),
  history: group('history', ['list', 'undo']),
  ai: group('ai', ['ask']),
  island: {
    ...group('island', ['state', 'addToShelf', 'removeFromShelf', 'clearShelf', 'copyClip', 'pinClip', 'removeClip', 'clearClips', 'focus', 'keepAwake', 'presentation', 'media', 'openAgent', 'transcribe', 'typeText', 'dismiss']),
    setExpanded: (v: boolean) => ipcRenderer.send('island.setExpanded', v),
  },
  on(channel: string, cb: (...args: unknown[]) => void) {
    const fn = (_e: unknown, ...args: unknown[]) => cb(...args);
    ipcRenderer.on(`event:${channel}`, fn);
    return () => ipcRenderer.removeListener(`event:${channel}`, fn);
  },
};

contextBridge.exposeInMainWorld('keeper', api);
