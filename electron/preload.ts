// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
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
  filekit: group('filekit', ['workflows', 'saveWorkflow', 'deleteWorkflow', 'runWorkflow', 'engines']),
  convert: group('convert', ['run', 'capabilities', 'duration', 'pageCount', 'mediaInfo', 'pdfFields', 'pdfThumbs', 'displays', 'setDisplay', 'phoneBackups', 'webToPdf', 'downloadVideo', 'cancelDownload', 'saveRecording']),
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
  security: group('security', ['overview', 'permissions', 'revoke', 'browsers', 'connections', 'installBrowserHost', 'persistence', 'scan', 'stopScan', 'scans', 'quarantine', 'quarantineFile', 'restore', 'deleteQuarantined', 'events', 'settings', 'setSettings', 'ignore', 'fix', 'installClamav', 'updateSignatures', 'checkPassword', 'exportReport']),
  rules: group('rules', ['list', 'save', 'remove', 'plan', 'run']),
  history: group('history', ['list', 'undo']),
  ai: group('ai', ['ask']),
  monitor: group('monitor', ['history', 'topToday', 'alerts', 'setAlertRules', 'docker', 'dockerAction', 'killTree', 'stopAgent', 'thermals', 'disks', 'speedTest', 'speedHistory']),
  forecast: group('forecast', ['places', 'savePlaces', 'get', 'alerts', 'radar', 'climate', 'trips']),
  platform: group('platform', ['list', 'set', 'action', 'ask']),
  usage: group('usage', ['get']),
  ashforde: group('ashforde', ['overview', 'monorail', 'install', 'update', 'checkUpdate', 'uninstall', 'launch', 'quit', 'connect', 'openPermission', 'action', 'prefs', 'setPrefs', 'useShortcut', 'coexist']),
  usageStats: group('usageStats', ['status', 'setOn', 'resetId', 'setBlocked', 'page']),
  // The system permissions Keeper's features use (first run, Settings → Permissions).
  permissions: group('permissions', ['list', 'request', 'openSettings', 'test', 'restart']),
  features: group('features', ['list', 'set', 'preset', 'sets', 'saveSet', 'removeSet', 'applySet', 'setPowerSets', 'live']),
  stage: group('stage', ['status', 'start', 'stop', 'toggle', 'extend', 'settings', 'setSettings', 'savePreset', 'removePreset', 'support', 'journal', 'detect', 'modes', 'apps', 'preview', 'displayInputs', 'setDisplayInput', 'overlays', 'tray']),
  awake: group('awake', ['status', 'start', 'stop', 'toggle', 'extend', 'parse', 'settings', 'setSettings', 'saveTrigger', 'removeTrigger', 'reorderTriggers', 'testTrigger', 'blockers', 'stats', 'resetStats', 'apps', 'setupClosedDisplay']),
  places: {
    ...group('places', ['list', 'eject', 'connect', 'discover', 'recentServers', 'forgetServer', 'folderSize', 'openAirDrop', 'shareTargets', 'share']),
    trash: group('places.trash', ['list', 'restore', 'remove', 'empty']),
  },
  controls: group('controls', ['list', 'set', 'preview', 'applyPreset', 'undo', 'open', 'bind', 'perApp', 'perAppSet', 'showPage']),
  catalog: group('catalog', ['list', 'search', 'read', 'preview', 'apply', 'reset', 'log', 'undo', 'backups', 'restoreBackup', 'favourites', 'setFavourite', 'exportProfile', 'previewProfile', 'applyProfile']),
  appctl: group('appctl', ['controls', 'list', 'get', 'preview', 'set', 'clear', 'running']),
  browserTabs: group('browserTabs', ['sessions', 'tab', 'info', 'siteSettings', 'setSite', 'clearSite', 'blockThirdPartyCookies', 'syncBlocking', 'siteBlocking', 'siteProxy', 'installHost']),
  guide: { ...group('guide', ['list', 'refresh', 'summary', 'setState', 'preview', 'apply', 'undo', 'open', 'verify', 'mini', 'flows', 'get', 'howTo', 'explain']), focus: () => ipcRenderer.send('guide.focus') },
  agentterm: group('agentterm', ['state', 'messages', 'post', 'send', 'postTask', 'handoff', 'takeOver', 'show', 'close', 'stopAll', 'pause', 'approve', 'setPerms', 'setPolicy', 'addAgent', 'transcript', 'runRecipe']),
  terminal: {
    ...group('terminal', ['settings', 'setSettings', 'shells', 'sshHosts', 'sessions', 'create', 'attach', 'kill', 'rename', 'setGroup', 'clear', 'notes', 'setNotes', 'saveWorkspace', 'webTools', 'webToolCommand', 'openWith', 'openAt', 'openWindow', 'toggleQuick', 'shellKind', 'integrationScript', 'remoteList', 'remoteDownload', 'remoteUpload', 'remoteMkdir', 'remoteRemove', 'remoteRename', 'remoteSavePassword', 'remoteDisconnect', 'hostPid']),
    input: (id: string, data: string) => ipcRenderer.send('terminal.input', id, data),
    resize: (id: string, cols: number, rows: number) => ipcRenderer.send('terminal.resize', id, cols, rows),
    detach: (id: string) => ipcRenderer.send('terminal.detach', id),
  },
  pim: group('pim', ['accounts', 'discover', 'testAccount', 'addAccount', 'signIn', 'cancelSignIn', 'updateAccount', 'removeAccount', 'oauthReady', 'folders', 'messages', 'refresh', 'older', 'open', 'setRead', 'setFlagged', 'move', 'archive', 'trash', 'junk', 'snooze', 'saveAttachment', 'openAttachment', 'unsubscribe', 'trustSender', 'draftFor', 'send', 'undoSend', 'outbox', 'saveDraft', 'suggest', 'ai', 'respond', 'rules', 'saveRules', 'pickFiles', 'calendars', 'setCalendar', 'occurrences', 'saveEvent', 'deleteEvent', 'quickAdd', 'parseQuick', 'subscribe', 'importIcs', 'exportIcs', 'syncCalendars', 'systemAccess', 'watchCalendar', 'openEvent', 'reminders', 'saveReminder', 'deleteReminder', 'alarms', 'saveAlarm', 'deleteAlarm', 'snoozeAlarm', 'stopRinging', 'startTimer', 'timerAction', 'saveClocks', 'scheduleWake', 'contacts', 'saveContact', 'deleteContact', 'prefs', 'setPrefs']),
  notes: group('notes', ['vaults', 'addVault', 'createVault', 'removeVault', 'open', 'close', 'vaultPath', 'read', 'write', 'create', 'createFolder', 'newNote', 'remove', 'rename', 'saveAttachment', 'fileUrl', 'reveal', 'backlinks', 'outgoing', 'unlinked', 'linkMention', 'tags', 'search', 'suggest', 'resolve', 'unresolved', 'graph', 'random', 'periodic', 'templates', 'fillTemplate', 'base', 'merge', 'extract', 'publish', 'render', 'preview', 'snapshots', 'snapshot', 'bookmarks', 'setBookmarks', 'capture', 'settings', 'setSettings', 'ask', 'assist', 'plugins', 'pluginCode', 'setPlugin']),
  islandTools: group('islandTools', ['store', 'saveStore', 'ask', 'askConnections', 'usage', 'setUsageOnline', 'usageOnline', 'salesConfig', 'setSalesProvider', 'removeSalesProvider', 'setSalesPrefs', 'sales', 'rates', 'quotes', 'chart', 'stocksKey', 'setStocksKey', 'shortcuts', 'runShortcut', 'importScript', 'macEvents', 'macReminders', 'setMacReminder']),
  // System monitor: live readings, history, dev servers, agents, sensors, menu-bar readings, the tool launcher.
  sysmon: group('sysmon', ['watch', 'live', 'history', 'exportCsv', 'clearHistory', 'devServers', 'stopServer', 'stopProject', 'restartServer', 'agents', 'stopAgentSession', 'sensors', 'procExtras', 'settings', 'setSettings', 'trayPreview', 'trayState', 'showPopover', 'containers', 'containerAction', 'mixer', 'setStream', 'setOutput', 'energy', 'setAppNap', 'tabs', 'openLauncher', 'openTool', 'recentTools', 'closeWindow', 'outputPreview']),
  procs: group('procs', ['sample', 'act', 'setPriority', 'details', 'icons', 'reveal', 'apps', 'restartKeeper', 'services', 'serviceAction']),
  fw: group('fw', ['status', 'setSettings', 'setMode', 'setProfile', 'saveProfile', 'removeProfile', 'setAutoSwitch', 'saveRule', 'removeRule', 'saveGroup', 'removeGroup', 'subscribe', 'refreshSubscriptions', 'tidy', 'exportRules', 'importRules', 'answer', 'connections', 'history', 'queryLog', 'setDomain', 'refreshLists', 'addList', 'apply', 'uninstall', 'testInject']),
  net: group('net', ['sample', 'health', 'vpnStatus', 'vpnAction', 'importPick', 'importText', 'importInstall', 'publicIp', 'settings', 'setSettings', 'geoStatus', 'geoDownload', 'geoRemove', 'exportCsv', 'icons']),
  cu: group('cu', ['state', 'settings', 'setSettings', 'saveSecret', 'removeSecret', 'show', 'takeOver', 'closeTab', 'record', 'stopRecording', 'runWorkflow', 'removeWorkflow', 'resume', 'forgetTask', 'editPlan', 'addSchedule', 'setSchedule', 'removeSchedule', 'runSchedule']),
  agents: group('agents', ['catalog', 'addConnection', 'listModels', 'usage', 'actions', 'setPermission', 'pending', 'decide', 'audit', 'gateway', 'rotateToken', 'clis', 'saveProfile', 'removeProfile', 'launch', 'skills', 'saveSkill', 'removeSkill', 'setSkillEnabled', 'importSkill', 'otherSkills', 'exportSkill', 'draftSkill', 'learning', 'suggestions', 'applySuggestion', 'dismissSuggestion', 'forget', 'record', 'graph', 'computerState', 'computerStop', 'computerShot']),
  abilities: group('abilities', ['settings', 'save', 'list', 'providers', 'setKey', 'testSearch', 'call', 'memories', 'addMemory', 'editMemory', 'removeMemory', 'clearMemories', 'costs', 'saveTask', 'removeTask', 'runTask', 'describeSchedule', 'savePersona', 'removePersona', 'saveProject', 'removeProject', 'members', 'saveTeam', 'removeTeam', 'runTeam', 'cancelTeam', 'transcribe', 'speak']),
  brain: group('brain', ['status', 'search', 'ask', 'cancel', 'setSemantic', 'removeModel', 'rebuild', 'connections', 'testConnection', 'apps', 'setAppConnected', 'server', 'modelSize']),
  remote: {
    ...group('remote', ['list', 'cloudAvailable', 'providers', 'providerForm', 'signIn', 'cancelSignIn', 'test', 'save', 'remove', 'check', 'quota', 'listDir', 'mkdir', 'rename', 'removeEntries', 'thumbnail', 'open', 'preview', 'uploadPick', 'upload', 'download', 'transfers', 'cancelTransfer', 'setOffline', 'search', 'scanLan', 'shares', 'mount']),
    startDrag: (id: string, entry: unknown) => ipcRenderer.send('remote.startDrag', id, entry),
  },
  sync: group('sync', ['overview', 'setPaused', 'setOptions', 'addFolder', 'updateFolder', 'removeFolder', 'ignoreOffer', 'rescan', 'conflicts', 'resolveConflict', 'versions', 'restoreVersion', 'versionsFor', 'destinations', 'addBackup', 'updateBackup', 'removeBackup', 'runBackup', 'cancelBackup', 'snapshots', 'snapshotFiles', 'restore', 'verifyBackup', 'addMirror', 'updateMirror', 'removeMirror', 'runMirror']),
  notesync: group('notesync', ['overview', 'setOptions', 'addConnector', 'updateConnector', 'removeConnector', 'test', 'plan', 'sync', 'search', 'tags', 'note', 'saveNote', 'copyTo', 'migrate', 'conflicts', 'resolveConflict', 'duplicates', 'resolveDuplicate', 'trash', 'restore', 'snapshots', 'snapshotNow', 'restoreSnapshot', 'exportAs', 'history', 'shareWithDevices', 'shortcutGuide']),
  lock: group('lock', ['status', 'canLock', 'newRecoveryKey', 'saveRecoveryKey', 'lock', 'inspect', 'unlock', 'relock', 'list', 'forget', 'setRelock', 'cancel']),
  link: {
    ...group('link', ['state', 'setSettings', 'rename', 'discover', 'invite', 'cancelInvite', 'pair', 'confirmPair', 'forget', 'setPermissions', 'renameDevice', 'check', 'sendFiles', 'answerOffer', 'sendClipboard', 'shares', 'list', 'download', 'addShare', 'removeShare', 'addForward', 'removeForward', 'companionInvite', 'answerCompanion', 'forgetCompanion', 'pending', 'setCompanionTerminal']),
    tunnel: group('link.tunnel', ['status', 'start', 'stop', 'installService']),
  },
  // Remote access between your own devices: help mode, fleet, actions, terminals, audit, unattended.
  access: group('access', ['helpStart', 'helpStop', 'helpStatus', 'helpJoin', 'setMeta', 'audit', 'exportAudit', 'exec', 'power', 'info', 'print', 'termOpen', 'termWrite', 'termResize', 'termClose', 'pendingCommands', 'answerCommand', 'unattended', 'setUnattended', 'directStats']),
  mesh: group('mesh', ['state', 'setOn', 'createNetwork', 'renameNetwork', 'removeNetwork', 'addMember', 'removeMember', 'answerInvite', 'setExit', 'offerExit', 'advertise', 'acceptRoutes', 'saveRule', 'removeRule', 'setDns', 'ping', 'pathTest', 'mtuProbe', 'setPlaces', 'trayPreview', 'config']),
  screen: {
    ...group('screen', ['state', 'session', 'view', 'stop', 'answer', 'setPolicy', 'displays', 'source', 'signal', 'frame', 'saveRecording', 'wake', 'learn', 'control', 'requestPermissions', 'android', 'androidInstall', 'androidDevices', 'androidPair', 'androidConnect', 'androidMirror', 'androidStop', 'androidDrop', 'airplay', 'airplayStart', 'airplayStop', 'setControl', 'print', 'reboot', 'invites', 'joinInvite', 'sources']),
    input: (sid: string, events: unknown[]) => ipcRenderer.send('screen.input', sid, events),
    ack: (sid: string, seq: number) => ipcRenderer.send('screen.ack', sid, seq),
    ready: (sid: string) => ipcRenderer.send('screen.ready', sid),
  },
  rdc: {
    ...group('rdc', ['state', 'save', 'remove', 'duplicate', 'setPassword', 'quick', 'probe', 'connect', 'disconnect', 'command', 'vncAttach', 'vncClipboard', 'vncKeys', 'vncSetViewOnly', 'webShow', 'webAction', 'watch', 'wake', 'importFile', 'importText', 'exportTo', 'exportText', 'engines', 'hostStatus', 'hostSet', 'hostFix', 'hostViaLink', 'places', 'setPlaces', 'trayPreview', 'showQuick', 'closeQuick', 'openRoute', 'openFile']),
    vncDetach: (sid: string) => ipcRenderer.send('rdc.vncDetach', sid),
    vncInput: (sid: string, events: unknown[]) => ipcRenderer.send('rdc.vncInput', sid, events),
    vncAck: (sid: string, seq: number) => ipcRenderer.send('rdc.vncAck', sid, seq),
  },
  tools: group('tools', ['networkInfo', 'publicIp', 'tweaks', 'setTweak', 'clearQuarantine', 'resetPermissions', 'pickApp', 'pickFiles', 'saveAs']),
  folders: group('folders', ['tidy']),
  aiActions: group('aiActions', ['provider', 'suggestName', 'summarize', 'receipts', 'altText', 'translateSubtitles']),
  // Tabs and windows that survive crashes (see electron/resilience.ts).
  session: {
    ...group('session', ['openWindow', 'lastSession', 'log', 'openDumps', 'report', 'relaunch']),
    initial: () => ipcRenderer.sendSync('session.initial'),
    save: (w: unknown) => ipcRenderer.send('session.save', w),
  },
  // Keeper's own processes and services (System → Keeper's processes).
  svc: group('svc', ['list', 'stop', 'restart', 'stopAllWork', 'held', 'limits']),
  appInfo: group('appInfo', ['updateStatus', 'checkForUpdates', 'installUpdate', 'downloadUpdate', 'whatsNew', 'releasesPage', 'versionNotes', 'scheduleUpdate', 'loginItem', 'setLoginItem']),
  island: {
    ...group('island', ['state', 'addToShelf', 'removeFromShelf', 'clearShelf', 'copyClip', 'pinClip', 'removeClip', 'clearClips', 'focus', 'keepAwake', 'presentation', 'media', 'openAgent', 'transcribe', 'typeText', 'dismiss']),
    ...group('island', ['createShelf', 'selectShelf', 'renameShelf', 'setShelfColor', 'pinShelf', 'closeShelf', 'reopenShelf', 'moveShelfItem', 'renameShelfItem', 'shelfAction', 'updateClip', 'toggleClipCollection', 'pasteClip', 'exportClips', 'importClips', 'openClips', 'openShelf', 'hide', 'setVolume', 'setMuted', 'setBrightness', 'refreshDevices', 'awakeStatus', 'layout', 'placementPreview', 'placeLog']),
    setExpanded: (v: boolean) => ipcRenderer.send('island.setExpanded', v),
    setInteractive: (v: boolean) => ipcRenderer.send('island.setInteractive', v),
    setSize: (w: number, h: number) => ipcRenderer.send('island.setSize', w, h),
    closeClips: () => ipcRenderer.send('island.closeClips'),
  },
  // Places & Tracks: timeline, trips, maps, live positions and activities.
  tracks: group('tracks', ['overview', 'brief', 'setConfig', 'setSecret', 'importFiles', 'preview', 'timeline', 'trips', 'tripHtml', 'tracks', 'track', 'renameTrack', 'removeTrack', 'records', 'heatmap', 'live', 'liveView', 'places', 'savePlace', 'removePlace', 'mergePlaces', 'zones', 'saveZone', 'removeZone', 'reservations', 'search', 'export', 'tile', 'connect', 'disconnect', 'syncNow', 'backup', 'wipe']),
  // Cues and Island+ (calls, levels, notifications, agents).
  cues: group('cues', ['state', 'list', 'create', 'update', 'toggleItem', 'skipItem', 'complete', 'reopen', 'snooze', 'remove', 'restore', 'purge', 'dismiss', 'templates', 'saveTemplate', 'removeTemplate', 'startTemplate', 'parse', 'suggest', 'settings', 'setSettings', 'compose', 'openFolder', 'exportMarkdown', 'syncWithDevices', 'popup', 'closePopup', 'reportPage', 'openPage']),
  islandx: group('islandx', ['status', 'callMute', 'callDismiss', 'hideFor', 'installAgentHooks', 'removeAgentHooks', 'openNotifyPermission', 'testNotification', 'startBreak', 'focusFor', 'mediaMode', 'openLauncher', 'showPage']),
  widgets: group('widgets', ['list', 'save', 'remove', 'photos', 'current', 'arrange', 'arranging', 'tint']),
  // Dictation anywhere and meeting recording; the listening pill streams its microphone samples here.
  voice: {
    ...group('voice', ['status', 'settings', 'setSettings', 'start', 'stop', 'toggle', 'cancel', 'confirm', 'history', 'removeTake', 'clearHistory', 'stats', 'reuseTake', 'correct', 'preview', 'downloadModel', 'removeModel', 'testKey', 'meetings', 'meeting', 'startMeeting', 'pauseMeeting', 'stopMeeting', 'dismissOffer', 'renameSpeaker', 'renameMeeting', 'writeNotes', 'exportMeeting', 'removeMeeting', 'linkEvent', 'eventsNear', 'tray', 'voices', 'forgetVoices', 'saveStatsPng']),
    hud: {
      ready: invoke('voice.hud.ready'),
      audio: (track: 'mic' | 'system', samples: Float32Array) => ipcRenderer.send('voice.audio', track, samples),
      level: () => undefined,
      key: (k: 'enter' | 'escape' | 'always') => ipcRenderer.send('voice.key', k),
    },
  },
  // Live wallpaper, vibes, ambient sound and folder icons (electron/services/wallpaper/).
  ambience: {
    ...group('ambience', ['state', 'set', 'setWallpaper', 'setPlaying', 'surprise', 'applyVibe', 'stepVibe', 'saveVibe', 'removeVibe', 'captureVibe', 'resetStarters', 'saveRules', 'savePalette', 'removePalette', 'pickMedia', 'setStill', 'restoreDesktop', 'cost', 'setMix', 'setSoundPlaying', 'sleep', 'openMixer', 'closeMixer', 'pickFolders', 'applyFolderIcon', 'restoreFolderIcon', 'folderIcons', 'frame', 'trayPreview']),
    report: (s: unknown) => ipcRenderer.send('ambience.report', s),
    ready: () => ipcRenderer.send('ambience.ready'),
  },
  on(channel: string, cb: (...args: unknown[]) => void) {
    const fn = (_e: unknown, ...args: unknown[]) => cb(...args);
    ipcRenderer.on(`event:${channel}`, fn);
    return () => ipcRenderer.removeListener(`event:${channel}`, fn);
  },
};

contextBridge.exposeInMainWorld('keeper', api);
