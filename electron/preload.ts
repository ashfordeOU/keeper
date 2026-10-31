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
  capture: group('capture', ['text', 'clipboardImage', 'readFile', 'screenshot', 'record', 'stopRecording', 'recordState', 'color', 'colors', 'history', 'removeHistory', 'clearHistory', 'options', 'setOptions', 'openLink']),
  weather: group('weather', ['get', 'search']),
  settings: group('settings', ['get', 'set', 'setSecret', 'hasSecret', 'pickFolder', 'pickFiles']),
  convert: group('convert', ['run', 'capabilities', 'duration', 'pageCount']),
  library: group('library', ['status', 'rescan', 'totals', 'recent', 'list', 'search', 'bySource', 'tags', 'setTags', 'inspect', 'readText', 'largeFiles']),
  files: {
    ...group('files', ['browse', 'thumbnail', 'icon', 'open', 'openWith', 'reveal', 'copyPaths', 'copyText', 'trash', 'move', 'copy', 'rename', 'previewRename', 'applyRename', 'newFolder', 'compress', 'readImage', 'writeImage', 'copyImage']),
    startDrag: (paths: string[]) => ipcRenderer.send('files.startDrag', paths),
    /** the real path of a File dropped from the OS */
    pathOf: (file: File) => webUtils.getPathForFile(file),
  },
  preview: {
    ...group('preview', ['info', 'text', 'bytes', 'archive', 'extract', 'transcode', 'filmstrip', 'image', 'storeThumb']),
    url: (p: string) => 'keeper-file://' + p.split(/([\\/])/).map((seg, i) => (i % 2 ? seg : encodeURIComponent(seg))).join(''),
  },
  duplicates: group('duplicates', ['scan']),
  cleanup: group('cleanup', ['scan', 'clean', 'details']),
  space: group('space', ['tree']),
  startup: group('startup', ['list', 'toggle']),
  apps: group('apps', ['list', 'uninstall']),
  protection: group('protection', ['check']),
  rules: group('rules', ['list', 'save', 'remove', 'plan', 'run']),
  history: group('history', ['list', 'undo']),
  ai: group('ai', ['ask']),
  monitor: group('monitor', ['history', 'topToday', 'alerts', 'setAlertRules', 'docker', 'dockerAction', 'killTree', 'stopAgent', 'thermals', 'disks', 'speedTest', 'speedHistory']),
  forecast: group('forecast', ['places', 'savePlaces', 'get', 'alerts', 'radar', 'climate', 'trips']),
  platform: group('platform', ['list', 'set', 'action', 'ask']),
  usage: group('usage', ['get']),
  features: group('features', ['list', 'set', 'preset']),
  places: {
    ...group('places', ['list', 'eject', 'connect', 'discover', 'recentServers', 'forgetServer', 'folderSize', 'openAirDrop', 'shareTargets', 'share']),
    trash: group('places.trash', ['list', 'restore', 'remove', 'empty']),
  },
  terminal: {
    ...group('terminal', ['settings', 'setSettings', 'shells', 'sshHosts', 'sessions', 'create', 'attach', 'kill', 'rename', 'setGroup', 'clear', 'notes', 'setNotes', 'saveWorkspace', 'webTools', 'webToolCommand', 'openWith', 'openWindow', 'toggleQuick', 'shellKind', 'integrationScript', 'remoteList', 'remoteDownload', 'remoteUpload', 'remoteMkdir', 'remoteRemove', 'remoteRename', 'remoteSavePassword', 'remoteDisconnect', 'hostPid']),
    input: (id: string, data: string) => ipcRenderer.send('terminal.input', id, data),
    resize: (id: string, cols: number, rows: number) => ipcRenderer.send('terminal.resize', id, cols, rows),
    detach: (id: string) => ipcRenderer.send('terminal.detach', id),
  },
  pim: group('pim', ['accounts', 'discover', 'testAccount', 'addAccount', 'signIn', 'cancelSignIn', 'updateAccount', 'removeAccount', 'oauthReady', 'folders', 'messages', 'refresh', 'older', 'open', 'setRead', 'setFlagged', 'move', 'archive', 'trash', 'junk', 'snooze', 'saveAttachment', 'openAttachment', 'unsubscribe', 'trustSender', 'draftFor', 'send', 'undoSend', 'outbox', 'saveDraft', 'suggest', 'ai', 'respond', 'rules', 'saveRules', 'pickFiles', 'calendars', 'setCalendar', 'occurrences', 'saveEvent', 'deleteEvent', 'quickAdd', 'parseQuick', 'subscribe', 'importIcs', 'exportIcs', 'syncCalendars', 'reminders', 'saveReminder', 'deleteReminder', 'alarms', 'saveAlarm', 'deleteAlarm', 'snoozeAlarm', 'stopRinging', 'startTimer', 'timerAction', 'saveClocks', 'scheduleWake', 'contacts', 'saveContact', 'deleteContact', 'prefs', 'setPrefs']),
  procs: group('procs', ['sample', 'act', 'setPriority', 'details', 'icons', 'reveal', 'apps', 'restartKeeper', 'services', 'serviceAction']),
  net: group('net', ['sample', 'health', 'vpnStatus', 'vpnAction', 'importPick', 'importText', 'importInstall', 'publicIp', 'settings', 'setSettings', 'geoStatus', 'geoDownload', 'geoRemove', 'exportCsv', 'icons']),
  agents: group('agents', ['catalog', 'addConnection', 'listModels', 'usage', 'actions', 'setPermission', 'pending', 'decide', 'audit', 'gateway', 'rotateToken', 'clis', 'saveProfile', 'removeProfile', 'launch', 'skills', 'saveSkill', 'removeSkill', 'setSkillEnabled', 'importSkill', 'otherSkills', 'exportSkill', 'draftSkill', 'learning', 'suggestions', 'applySuggestion', 'dismissSuggestion', 'forget', 'record', 'graph']),
  brain: group('brain', ['status', 'search', 'ask', 'cancel', 'setSemantic', 'removeModel', 'rebuild', 'connections', 'testConnection', 'apps', 'setAppConnected', 'server', 'modelSize']),
  remote: {
    ...group('remote', ['list', 'cloudAvailable', 'providers', 'providerForm', 'signIn', 'cancelSignIn', 'test', 'save', 'remove', 'check', 'quota', 'listDir', 'mkdir', 'rename', 'removeEntries', 'thumbnail', 'open', 'preview', 'uploadPick', 'upload', 'download', 'transfers', 'cancelTransfer', 'setOffline', 'search', 'scanLan', 'shares', 'mount']),
    startDrag: (id: string, entry: unknown) => ipcRenderer.send('remote.startDrag', id, entry),
  },
  sync: group('sync', ['overview', 'setPaused', 'setOptions', 'addFolder', 'updateFolder', 'removeFolder', 'ignoreOffer', 'rescan', 'conflicts', 'resolveConflict', 'versions', 'restoreVersion', 'versionsFor', 'destinations', 'addBackup', 'updateBackup', 'removeBackup', 'runBackup', 'cancelBackup', 'snapshots', 'snapshotFiles', 'restore', 'verifyBackup', 'addMirror', 'updateMirror', 'removeMirror', 'runMirror']),
  lock: group('lock', ['status', 'canLock', 'newRecoveryKey', 'saveRecoveryKey', 'lock', 'inspect', 'unlock', 'relock', 'list', 'forget', 'setRelock', 'cancel']),
  link: {
    ...group('link', ['state', 'setSettings', 'rename', 'discover', 'invite', 'cancelInvite', 'pair', 'confirmPair', 'forget', 'setPermissions', 'renameDevice', 'check', 'sendFiles', 'answerOffer', 'sendClipboard', 'shares', 'list', 'download', 'addShare', 'removeShare', 'addForward', 'removeForward', 'companionInvite', 'answerCompanion', 'forgetCompanion', 'pending']),
    tunnel: group('link.tunnel', ['status', 'start', 'stop', 'installService']),
  },
  screen: {
    ...group('screen', ['state', 'session', 'view', 'stop', 'answer', 'setPolicy', 'displays', 'source', 'signal', 'frame', 'saveRecording', 'wake', 'learn', 'control', 'requestPermissions', 'android', 'androidInstall', 'androidDevices', 'androidPair', 'androidConnect', 'androidMirror', 'androidStop', 'androidDrop', 'airplay', 'airplayStart', 'airplayStop']),
    input: (sid: string, events: unknown[]) => ipcRenderer.send('screen.input', sid, events),
    ack: (sid: string, seq: number) => ipcRenderer.send('screen.ack', sid, seq),
    ready: (sid: string) => ipcRenderer.send('screen.ready', sid),
  },
  tools: group('tools', ['networkInfo', 'publicIp', 'tweaks', 'setTweak', 'clearQuarantine', 'resetPermissions', 'pickApp', 'pickFiles', 'saveAs']),
  folders: group('folders', ['tidy']),
  aiActions: group('aiActions', ['provider', 'suggestName', 'summarize', 'receipts', 'altText', 'translateSubtitles']),
  appInfo: group('appInfo', ['updateStatus', 'checkForUpdates', 'installUpdate', 'downloadUpdate', 'whatsNew', 'releasesPage', 'versionNotes', 'scheduleUpdate', 'loginItem', 'setLoginItem']),
  island: {
    ...group('island', ['state', 'addToShelf', 'removeFromShelf', 'clearShelf', 'copyClip', 'pinClip', 'removeClip', 'clearClips', 'focus', 'keepAwake', 'presentation', 'media', 'openAgent', 'transcribe', 'typeText', 'dismiss']),
    ...group('island', ['createShelf', 'selectShelf', 'renameShelf', 'setShelfColor', 'pinShelf', 'closeShelf', 'reopenShelf', 'moveShelfItem', 'renameShelfItem', 'shelfAction', 'updateClip', 'toggleClipCollection', 'pasteClip', 'exportClips', 'importClips', 'openClips', 'openShelf', 'hide', 'setVolume', 'setMuted', 'setBrightness', 'refreshDevices', 'awakeStatus', 'layout', 'placementPreview']),
    setExpanded: (v: boolean) => ipcRenderer.send('island.setExpanded', v),
    setSize: (w: number, h: number) => ipcRenderer.send('island.setSize', w, h),
    closeClips: () => ipcRenderer.send('island.closeClips'),
  },
  widgets: group('widgets', ['list', 'save', 'remove', 'photos', 'current']),
  on(channel: string, cb: (...args: unknown[]) => void) {
    const fn = (_e: unknown, ...args: unknown[]) => cb(...args);
    ipcRenderer.on(`event:${channel}`, fn);
    return () => ipcRenderer.removeListener(`event:${channel}`, fn);
  },
};

contextBridge.exposeInMainWorld('keeper', api);
