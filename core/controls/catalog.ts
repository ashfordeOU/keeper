// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Every Quick Control and how each system lets an app change it. The README's
// table and docs/QUICK-CONTROLS.md are written from this list.

import type { ControlDef, How, Os, Preset } from './types';

const s = (mac: How, win: How, linux: How, notes: Partial<Record<Os, string>> = {}): ControlDef['support'] => ({
  darwin: { how: mac, note: notes.darwin },
  win32: { how: win, note: notes.win32 },
  linux: { how: linux, note: notes.linux },
});

export const CONTROLS: ControlDef[] = [
  // ---------------------------------------------------------------- network
  { id: 'wifi', group: 'network', kind: 'bool', label: 'Wi-Fi', desc: 'The Wi-Fi radio.', topic: 'wifi',
    support: s('direct', 'direct', 'direct', { win32: 'Through the Windows radio switch (the same one as in Quick Settings).' }) },
  { id: 'bluetooth', group: 'network', kind: 'bool', label: 'Bluetooth', desc: 'The Bluetooth radio.', topic: 'bluetooth',
    support: s('guide', 'direct', 'direct', { darwin: 'macOS has no public way for apps to switch Bluetooth; Keeper opens Bluetooth settings.' }) },
  { id: 'airplane', group: 'network', kind: 'bool', label: 'Airplane mode', desc: 'Every radio off at once.', topic: 'airplane',
    support: s('none', 'guide', 'direct', { darwin: 'Macs have no airplane mode; switch Wi-Fi and Bluetooth off instead.', win32: 'Windows does not let apps switch airplane mode; Keeper opens it.', linux: 'Through NetworkManager (all radios).' }) },
  { id: 'vpn', group: 'network', kind: 'bool', label: 'VPN', desc: 'Connect or disconnect your first VPN (choose others in VPN).', keeper: true, topic: 'vpn',
    support: s('direct', 'direct', 'direct', { darwin: 'VPNs set up in System Settings or by their apps.', win32: 'Windows VPN connections and WireGuard tunnels.', linux: 'NetworkManager VPNs.' }) },
  { id: 'encryptedDns', group: 'network', kind: 'choice', label: 'Encrypted DNS for the system', desc: 'Which encrypted DNS service every app uses.', topic: 'network',
    choices: [{ value: 'off', label: 'Off' }, { value: 'quad9', label: 'Quad9' }, { value: 'cloudflare', label: 'Cloudflare' }], weaker: 'off', risk: 'Without encrypted DNS, the network you are on can see and change every name your apps look up.',
    support: s('guide', 'admin', 'admin', { darwin: 'macOS needs a DNS settings profile for system-wide encrypted DNS; Keeper’s DNS filter (Firewall) encrypts it instead.', win32: 'Windows 11 encrypted DNS (DoH) on the main adapter.', linux: 'systemd-resolved DNS over TLS on the active connection.' }) },
  { id: 'proxy', group: 'network', kind: 'bool', label: 'Proxy settings', desc: 'Open the system’s proxy settings.', topic: 'proxy',
    support: s('guide', 'guide', 'guide') },
  { id: 'ipv6', group: 'network', kind: 'bool', label: 'IPv6', desc: 'IPv6 on the main network connection.', topic: 'network', weaker: true, risk: 'Some VPNs only cover IPv4; leaving IPv6 on can let traffic go around the VPN.',
    support: s('admin', 'admin', 'admin') },
  { id: 'hotspot', group: 'network', kind: 'bool', label: 'Hotspot', desc: 'Share this computer’s internet over Wi-Fi.', topic: 'sharing', weaker: true, risk: 'Other devices will reach the internet through this computer.',
    support: s('guide', 'guide', 'direct', { darwin: 'Internet Sharing is only in System Settings.', win32: 'Mobile hotspot is only in Settings for apps like Keeper.', linux: 'NetworkManager hotspot on the Wi-Fi device.' }) },
  { id: 'publicNetwork', group: 'network', kind: 'bool', label: 'Treat this network as public', desc: 'Hide this computer from others on the network.', topic: 'network', weaker: false, risk: 'Others on this network may see this computer and its shared folders.',
    support: s('guide', 'admin', 'guide', { darwin: 'Turn off the sharing services in Sharing settings.', win32: 'The network profile (Public or Private).', linux: 'Firewall zones depend on the distribution; use Firewall below.' }) },
  { id: 'airdrop', group: 'network', kind: 'bool', label: 'AirDrop', desc: 'Let nearby Apple devices send to this Mac.', topic: 'airdrop', weaker: true, risk: 'Strangers nearby can send you files when it is open to everyone.',
    support: s('direct', 'none', 'none', { darwin: 'Takes effect after Finder restarts or at next login.' }) },
  { id: 'wakeOnLan', group: 'network', kind: 'bool', label: 'Wake for network access', desc: 'Let other computers wake this one over the network.', topic: 'power',
    support: s('admin', 'guide', 'admin', { win32: 'Set on the adapter in Device Manager.', linux: 'On the wired adapter (ethtool).' }) },

  // ---------------------------------------------------------------- firewall
  { id: 'osFirewall', group: 'firewall', kind: 'bool', label: 'System firewall', desc: 'The firewall built into the system, for incoming connections.', topic: 'firewall', weaker: false, risk: 'Any app could accept connections from the network.',
    support: s('admin', 'admin', 'admin', { linux: 'ufw or firewalld, whichever is installed.' }) },
  { id: 'stealth', group: 'firewall', kind: 'bool', label: 'Stealth mode', desc: 'Do not answer probes from the network.', topic: 'firewall', weaker: false,
    support: s('admin', 'none', 'none', { win32: 'Windows already drops unsolicited traffic when the firewall is on.', linux: 'Most firewalls already drop rather than reject.' }) },
  { id: 'blockIncoming', group: 'firewall', kind: 'bool', label: 'Block all incoming connections', desc: 'Even ones you allowed before (sharing stops working).', topic: 'firewall', weaker: false,
    support: s('admin', 'admin', 'none', { linux: 'ufw and firewalld already refuse incoming connections you have not allowed; switch the system firewall on above.' }) },
  { id: 'keeperFwMode', group: 'firewall', kind: 'choice', label: 'Keeper firewall', desc: 'What Keeper does with a new connection.', keeper: true, topic: 'firewall', weaker: 'silent-allow', risk: 'New connections will be allowed without asking you.',
    choices: [{ value: 'alert', label: 'Ask me' }, { value: 'silent-allow', label: 'Quiet: allow' }, { value: 'silent-deny', label: 'Quiet: deny' }],
    support: s('direct', 'direct', 'direct') },
  { id: 'keeperEnforce', group: 'firewall', kind: 'bool', label: 'Keeper firewall rules in force', desc: 'Put Keeper’s rules into the system firewall.', keeper: true, weaker: false,
    support: s('admin', 'admin', 'admin') },
  { id: 'dnsFilter', group: 'firewall', kind: 'bool', label: 'DNS filter', desc: 'Keeper’s encrypted DNS with blocklists.', keeper: true, weaker: false,
    support: s('direct', 'direct', 'direct') },
  { id: 'blocklists', group: 'firewall', kind: 'bool', label: 'Blocklists', desc: 'Ads, trackers and malware lists in the DNS filter.', keeper: true, weaker: false,
    support: s('direct', 'direct', 'direct') },

  // ---------------------------------------------------------------- privacy
  { id: 'camera', group: 'privacy', kind: 'bool', label: 'Camera for apps', desc: 'Whether apps may use the camera at all.', topic: 'camera', weaker: true,
    support: s('guide', 'direct', 'admin', { darwin: 'macOS only lets you change this per app in Privacy & Security; Keeper can make an app ask again.', win32: 'The “Let apps access your camera” switch for your account.', linux: 'Unloads the camera driver (uvcvideo) until switched back on.' }) },
  { id: 'microphone', group: 'privacy', kind: 'bool', label: 'Microphone for apps', desc: 'Whether apps may use the microphone at all.', topic: 'microphone', weaker: true,
    support: s('guide', 'direct', 'direct', { darwin: 'Per app only, in Privacy & Security.', win32: 'The “Let apps access your microphone” switch for your account.', linux: 'Mutes the default input (an app can still unmute it).' }) },
  { id: 'location', group: 'privacy', kind: 'bool', label: 'Location for apps', desc: 'Whether apps may ask where you are.', topic: 'location', weaker: true,
    support: s('guide', 'direct', 'none', { win32: 'The “Let apps access your location” switch for your account.', linux: 'Desktop location services are off unless an app uses GeoClue; see the app’s own settings.' }) },
  { id: 'advertisingId', group: 'privacy', kind: 'bool', label: 'Advertising ID', desc: 'An ID apps use to show you personalised ads.', topic: 'privacy', weaker: true,
    support: s('guide', 'direct', 'none') },
  { id: 'diagnostics', group: 'privacy', kind: 'bool', label: 'Send diagnostics to the system maker', desc: 'Crash and usage reports.', topic: 'diagnostics', weaker: true,
    support: s('admin', 'admin', 'admin', { darwin: 'Share Mac Analytics.', win32: 'Optional diagnostic data (the required level stays on Windows Home and Pro).', linux: 'Crash reporting (apport/whoopsie) where installed.' }) },
  { id: 'clipboardHistory', group: 'privacy', kind: 'bool', label: 'System clipboard history', desc: 'Windows keeps what you copy.', weaker: true,
    support: s('none', 'direct', 'none', { darwin: 'Keeper’s own clipboard history is in the Island.' }) },
  { id: 'clipboardSync', group: 'privacy', kind: 'bool', label: 'Clipboard sync across devices', desc: 'What you copy goes to your other devices via the cloud.', topic: 'airdrop', weaker: true,
    support: s('guide', 'direct', 'none', { darwin: 'Universal Clipboard follows Handoff in General settings.' }) },
  { id: 'activityHistory', group: 'privacy', kind: 'bool', label: 'Activity history', desc: 'The system remembers apps and files you used.', topic: 'privacy', weaker: true,
    support: s('none', 'admin', 'guide', { linux: 'GNOME: Privacy → File History.' }) },
  { id: 'lockOnSleep', group: 'privacy', kind: 'bool', label: 'Ask for the password after sleep or screen saver', desc: 'Lock the screen when it wakes.', topic: 'lockScreen', weaker: false, risk: 'Anyone could use the computer after it wakes.',
    support: s('guide', 'guide', 'direct', { linux: 'GNOME screen lock (gsettings).' }) },
  { id: 'bluetoothDiscoverable', group: 'privacy', kind: 'bool', label: 'Bluetooth discoverable', desc: 'Nearby devices can find this computer.', topic: 'bluetooth', weaker: true,
    support: s('guide', 'guide', 'direct') },
  { id: 'findMy', group: 'privacy', kind: 'bool', label: 'Find My', desc: 'Locate this computer if it is lost.', topic: 'findMy',
    support: s('guide', 'guide', 'none') },
  { id: 'assistantData', group: 'privacy', kind: 'bool', label: 'Assistant and AI data settings', desc: 'What the built-in assistant may learn from you.', topic: 'privacy',
    support: s('guide', 'guide', 'none') },

  // ---------------------------------------------------------------- security
  { id: 'realtime', group: 'security', kind: 'bool', label: 'Keeper real-time protection', desc: 'Check new downloads and files as they arrive.', keeper: true, weaker: false,
    support: s('direct', 'direct', 'direct') },
  { id: 'autoQuarantine', group: 'security', kind: 'bool', label: 'Quarantine what is found', desc: 'Move detections into Keeper’s quarantine at once.', keeper: true, weaker: false,
    support: s('direct', 'direct', 'direct') },
  { id: 'gatekeeper', group: 'security', kind: 'bool', label: 'Gatekeeper', desc: 'Only open apps from known developers.', topic: 'security', weaker: false, risk: 'Any app could open without being checked.',
    support: s('admin', 'none', 'none', { darwin: 'Turning it off also needs a confirmation in System Settings on recent macOS.' }) },
  { id: 'defenderRealtime', group: 'security', kind: 'bool', label: 'Microsoft Defender real-time protection', desc: 'The antivirus built into Windows.', topic: 'security', weaker: false, risk: 'Windows will stop checking files for malware. Tamper Protection may block this, which is good.',
    support: s('none', 'admin', 'none') },
  { id: 'smartScreen', group: 'security', kind: 'bool', label: 'SmartScreen', desc: 'Warn before running unknown downloads.', topic: 'security', weaker: false,
    support: s('none', 'guide', 'none') },
  { id: 'autoUpdates', group: 'security', kind: 'bool', label: 'Automatic system updates', desc: 'Download and install security fixes on their own.', topic: 'updates', weaker: false, risk: 'Security fixes will wait until you install them yourself.',
    support: s('admin', 'guide', 'admin', { win32: 'Windows manages updates itself; pause them in Settings.', linux: 'unattended-upgrades where installed.' }) },
];

export const CONTROL_BY_ID = new Map(CONTROLS.map((c) => [c.id, c]));

export const GROUPS: { id: ControlDef['group']; label: string }[] = [
  { id: 'network', label: 'Network' },
  { id: 'firewall', label: 'Firewall' },
  { id: 'privacy', label: 'Privacy' },
  { id: 'security', label: 'Security' },
];

export const PRESETS: Preset[] = [
  { id: 'public-wifi', name: 'Public Wi-Fi', desc: 'Firewall on and quiet, stealth, VPN, encrypted DNS, AirDrop and hotspot off, network treated as public.',
    values: { osFirewall: true, stealth: true, vpn: true, encryptedDns: 'quad9', dnsFilter: true, airdrop: false, hotspot: false, publicNetwork: true, bluetoothDiscoverable: false } },
  { id: 'home', name: 'Home', desc: 'Firewall on, sharing allowed on the home network, encrypted DNS.',
    values: { osFirewall: true, blockIncoming: false, publicNetwork: false, dnsFilter: true } },
  { id: 'presentation', name: 'Presenting / private', desc: 'Camera and microphone off for apps, clipboard sync and Bluetooth discovery off.',
    values: { camera: false, microphone: false, clipboardSync: false, bluetoothDiscoverable: false } },
  { id: 'lockdown', name: 'Lockdown', desc: 'Everything closed: firewall blocks all incoming, Keeper denies new connections quietly, radios you do not need off, camera and microphone off.',
    values: { osFirewall: true, stealth: true, blockIncoming: true, keeperFwMode: 'silent-deny', dnsFilter: true, blocklists: true, camera: false, microphone: false, location: false, airdrop: false, hotspot: false, bluetooth: false, realtime: true, autoQuarantine: true } },
];

export const PRESET_BY_ID = new Map(PRESETS.map((p) => [p.id, p]));
