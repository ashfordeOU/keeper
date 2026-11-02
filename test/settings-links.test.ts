// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Every "Settings → X" Keeper writes names a place that exists, and becomes an Open button.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { linkInMessage, SETTINGS_LINKS } from '../core/settings-links';

const ROOT = path.resolve(__dirname, '..');
function files(dir: string): string[] {
  const out: string[] = [];
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (/\.(ts|tsx)$/.test(n)) out.push(p);
  }
  return out;
}

// Places inside a section that messages may name after it ("Settings → Island → Tools").
const SECTIONS = SETTINGS_LINKS.filter((l) => l.label.startsWith('Settings → ')).map((l) => l.label.slice('Settings → '.length));
// Other apps' and systems' own settings that Keeper names (not Keeper's).
const NOT_KEEPER = /(System|Windows|macOS|desktop’s|desktop's|GNOME|KDE|phone’s|phone's|browser’s|browser's|Chrome|Firefox|Android|iPhone|iOS|Proton|Zoho Mail’s|Fastmail’s|Obsidian|app’s|router’s|OwnTracks|Teams|Zoom|Slack|Discord) ?(\w+ )?$/;

// Named after "Settings → " but not a Keeper section: other systems' and services' own settings
// pages (Windows, Android, payment services, notes apps), and Keeper rows written with their section
// implied by the page the message is on. A new name has to be one of these or a real section.
const ELSEWHERE = ['System', 'Apps', 'Network', 'Power', 'Bluetooth', 'Wi-Fi', 'Sharing', 'Users', 'Notifications', 'Time & language', 'Windows Update', 'About phone', 'API', 'Advanced', 'Backup & export', 'Dictation',
  'Keeper inside your computer', 'Placement', 'Results go to', 'Reopen where I left off', 'Folders', 'Let AI agents edit notes', 'editor command', 'Spell my project', 'Where it appears', 'Keeper', 'Mail &amp; Calendar'];

describe('Settings → links', () => {
  it('every Keeper "Settings → X" in messages names a section that exists', () => {
    const bad: string[] = [];
    for (const f of [...files(path.join(ROOT, 'src')), ...files(path.join(ROOT, 'core')), ...files(path.join(ROOT, 'electron'))]) {
      const text = readFileSync(f, 'utf8');
      for (const m of text.matchAll(/Settings → ([^'"`<\n]{0,60})/g)) {
        const before = text.slice(Math.max(0, m.index! - 24), m.index!);
        if (NOT_KEEPER.test(before) || /\$\{/.test(m[1])) continue;
        if (path.basename(f) === 'settings-links.ts') continue;
        if (![...SECTIONS, ...ELSEWHERE].some((s) => m[1].startsWith(s))) bad.push(`${path.relative(ROOT, f)}: Settings → ${m[1].slice(0, 40)}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('a message naming one gets its page; the system’s own settings do not', () => {
    expect(linkInMessage('Add your Anthropic API key in Settings → AI & Brain.')?.route).toBe('settings:brain');
    expect(linkInMessage('Memory is switched off in Agents → Abilities.')?.route).toBe('agents:abilities');
    expect(linkInMessage('Open System Settings → Privacy & Security → Accessibility')).toBeUndefined();
    expect(linkInMessage('Nothing here')).toBeUndefined();
  });
});
