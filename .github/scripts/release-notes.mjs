#!/usr/bin/env node
// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The body of a GitHub Release, written by the release workflow.
//
//   node .github/scripts/release-notes.mjs --version 1.0.0 --platforms mac,windows,linux --out notes.md
//
// The text comes from .github/release-notes/<version>.md when that file exists (a
// hand-written summary, such as the one for 1.0.0), otherwise from the
// "## [<version>]" section of CHANGELOG.md. Long notes with many sections stay
// readable: every "###" heading stays visible, and a long section's list folds
// under a <details> line ("12 changes") on GitHub. Keeper's own Software Update
// window drops the HTML and shows the heading and the list as they are. Then a line
// says which systems the release is for when it is not all of them, and how to
// install and open it. --mac-signing developer-id (the release workflow passes
// .github/release.json's "macSigning") changes the Mac first-launch notes and marks
// the release so self-signed copies warn about the one last keychain question.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const REPO = 'ashfordeOU/keeper';
/** GitHub refuses a release body over 125,000 characters. */
const MAX = 120_000;
/** Notes longer than this, or with more sections than SECTIONS, fold their long sections. */
const LONG = 6_000;
const SECTIONS = 6;
const NAMES = { mac: 'macOS', windows: 'Windows', linux: 'Linux' };
export const ALL_PLATFORMS = ['mac', 'windows', 'linux'];

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The "## [version]" section of a changelog, without its heading. */
export function changelogSection(changelog, version) {
  const lines = changelog.replace(/\r/g, '').split('\n');
  const start = lines.findIndex((l) => new RegExp(`^## \\[${esc(version)}\\]`).test(l));
  if (start < 0) return '';
  let end = lines.findIndex((l, i) => i > start && /^## /.test(l));
  if (end < 0) end = lines.length;
  return lines.slice(start + 1, end).join('\n').trim();
}

/**
 * Long, many-section notes: each "###" section keeps its heading, and its list folds
 * under "N changes" when the section is long. Short notes are returned unchanged.
 */
export function foldLongNotes(md) {
  const text = md.replace(/\r/g, '').trim();
  const parts = text.split(/\n(?=### )/);
  const sections = parts.filter((p) => p.startsWith('### '));
  if (text.length <= LONG && sections.length <= SECTIONS) return text;
  const out = parts.map((part) => {
    if (!part.startsWith('### ')) return part.trim();
    const nl = part.indexOf('\n');
    const heading = nl < 0 ? part : part.slice(0, nl);
    const body = nl < 0 ? '' : part.slice(nl + 1).trim();
    const items = body.split('\n').filter((l) => /^[-*] /.test(l)).length;
    if (body.length < 600 && items <= 4) return `${heading}\n\n${body}`.trim();
    const label = items ? `${items} change${items === 1 ? '' : 's'}` : 'Details';
    return `${heading}\n\n<details><summary>${label}</summary>\n\n${body}\n\n</details>`;
  });
  const titles = sections.map((s) => s.slice(4, s.indexOf('\n') < 0 ? undefined : s.indexOf('\n')).trim());
  const contents = `**In this release:** ${titles.join(' · ')}`;
  // Any introduction before the first section stays first, then the contents line.
  const intro = parts[0].startsWith('### ') ? [] : [out.shift()];
  return [...intro, contents, ...out].filter(Boolean).join('\n\n');
}

function platformLine(platforms) {
  if (ALL_PLATFORMS.every((p) => platforms.includes(p))) return '';
  const inIt = platforms.map((p) => NAMES[p]).join(' and ');
  const left = ALL_PLATFORMS.filter((p) => !platforms.includes(p)).map((p) => NAMES[p]);
  return `> **This release is for ${inIt}.** ${left.join(' and ')} ${left.length > 1 ? 'follow' : 'follows'} in a later release; until then copies there stay on their current version and are not offered this one, and the install scripts keep installing the newest release with a ${left.join(' or ')} build.`;
}

/**
 * Marks a release whose Mac build is signed with Ashforde's Developer ID. Keeper's updater looks
 * for it (DEVELOPER_ID_RELEASE_MARKER in core/update-verify.ts) to warn self-signed copies that
 * macOS asks once more. An HTML comment: GitHub and the Software Update window do not show it.
 */
export const DEVELOPER_ID_RELEASE_MARKER = '<!-- keeper:mac-signing=developer-id -->';
export const MAC_SIGNINGS = ['self-signed', 'developer-id'];

function installSection(platforms, prerelease, macSigning = 'self-signed') {
  const beta = prerelease ? ' -s -- --beta' : '';
  const out = ['### Install'];
  if (platforms.includes('mac') || platforms.includes('linux')) {
    const who = [platforms.includes('mac') && 'a Mac', platforms.includes('linux') && 'Linux'].filter(Boolean).join(' or ');
    out.push(`On ${who}, from Terminal:`, '```bash', `curl -fsSL https://raw.githubusercontent.com/${REPO}/main/scripts/install.sh | sh${beta}`, '```');
  }
  if (platforms.includes('windows') && !prerelease) {
    out.push('On Windows, in PowerShell:', '```powershell', `irm https://raw.githubusercontent.com/${REPO}/main/scripts/install.ps1 | iex`, '```');
  }
  out.push('Or download the file for your system below. Copies already installed update themselves.');
  if (platforms.includes('mac') && macSigning === 'developer-id') {
    out.push(
      '',
      '**First launch on a Mac.** This build is signed with Ashforde\'s Apple Developer ID and notarised by Apple, so it opens like any other app, with no **Open Anyway** step.',
      '- Updating a copy signed with Keeper\'s own certificate ("Keeper Self-Signed"): macOS asks once more for your login password to use "Keeper Safe Storage" (choose **Always Allow**) and may ask you to allow Keeper again in **System Settings → Privacy & Security**. After this, updates don\'t ask.',
    );
  } else if (platforms.includes('mac')) {
    out.push(
      '',
      '**First launch on a Mac.** This build is signed with Keeper\'s own certificate, not yet an Apple Developer ID, so:',
      '- After a download from this page (the install script skips this), macOS says it cannot check the app. Open **System Settings → Privacy & Security** and click **Open Anyway** (on macOS 14 and older, Control-click Keeper and choose **Open**). Once is enough.',
      '- macOS may ask whether Keeper may use its saved keys in your keychain ("Keeper Safe Storage"). Click **Always Allow**. This comes back once after each update until the Developer ID build; your permissions (Accessibility, Screen Recording…) carry over.',
    );
  }
  if (platforms.includes('windows')) out.push('', '**First launch on Windows.** If SmartScreen appears, choose **More info → Run anyway** (the installer is not yet signed with a paid certificate).');
  out.push('', `Check a download: \`SHA256SUMS.txt\` (signed with Sigstore) and \`gh attestation verify <file> --repo ${REPO}\`. Privacy and security: [Privacy](https://github.com/${REPO}#privacy) · [SECURITY.md](https://github.com/${REPO}/blob/main/SECURITY.md).`);
  return out.join('\n');
}

/** The whole release body. */
export function buildNotes({ version, platforms = ALL_PLATFORMS, changelog = '', override = '', macSigning = 'self-signed' }) {
  if (!MAC_SIGNINGS.includes(macSigning)) throw new Error(`macSigning must be one of ${MAC_SIGNINGS.join(', ')}, not "${macSigning}"`);
  const prerelease = version.includes('-');
  const marker = platforms.includes('mac') && macSigning === 'developer-id' ? DEVELOPER_ID_RELEASE_MARKER : '';
  // A hand-written summary is shown as written; a changelog section folds when it is long.
  let body = override.trim() || foldLongNotes(changelogSection(changelog, version)) || `Keeper ${version}`;
  const lead = platformLine(platforms);
  const install = installSection(platforms, prerelease, macSigning);
  const room = MAX - marker.length - lead.length - install.length - 400;
  if (body.length > room) {
    body = `${body.slice(0, room).replace(/\n[^\n]*$/, '')}\n\n…the rest is in [CHANGELOG.md](https://github.com/${REPO}/blob/v${version}/CHANGELOG.md).`;
    // A cut inside a fold would leave it open to the end of the page.
    if ((body.match(/<details>/g) ?? []).length > (body.match(/<\/details>/g) ?? []).length) body += '\n\n</details>';
  }
  return [marker, lead, body, install].filter(Boolean).join('\n\n') + '\n';
}

function main(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i += 2) a[argv[i].replace(/^--/, '')] = argv[i + 1];
  if (!a.version) throw new Error('usage: release-notes.mjs --version X [--platforms mac,windows,linux] [--mac-signing self-signed|developer-id] [--out notes.md]');
  const platforms = (a.platforms ?? ALL_PLATFORMS.join(',')).split(',').filter(Boolean);
  const overrideFile = path.join(ROOT, '.github', 'release-notes', `${a.version}.md`);
  const notes = buildNotes({
    version: a.version,
    platforms,
    changelog: readFileSync(path.join(ROOT, a.changelog ?? 'CHANGELOG.md'), 'utf8'),
    override: existsSync(overrideFile) ? readFileSync(overrideFile, 'utf8').replace(/^<!--[\s\S]*?-->\s*/, '') : '',
    macSigning: a['mac-signing'] || 'self-signed',
  });
  if (a.out) writeFileSync(a.out, notes);
  else process.stdout.write(notes);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
