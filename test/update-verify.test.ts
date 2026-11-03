// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import {
  APPLE_TEAM_ID, checksumFor, checksumProblem, designatedRequirement, DEVELOPER_ID_APP_REQUIREMENT, DEVELOPER_ID_RELEASE_MARKER, DEVELOPER_ID_SIGNER,
  isAdHocRequirement, isSignerChange, parseChecksums, releaseSignedWithDeveloperId, updateRequirements,
} from '../core/update-verify';

const A = 'a'.repeat(64);
const B = 'B'.repeat(64);
const SUMS = [
  `${A}  Keeper-mac-arm64.dmg`,
  `${B} *Keeper-linux-amd64.deb`,
  `${'c'.repeat(64)}  ./sub/Keeper-linux-x86_64.rpm`,
  '',
  'not a checksum line',
  `${'d'.repeat(63)}  short.txt`,
].join('\r\n');

describe('SHA256SUMS.txt', () => {
  it('reads sha256sum lines, with or without the binary-mode star', () => {
    const m = parseChecksums(SUMS);
    expect(m.get('Keeper-mac-arm64.dmg')).toBe(A);
    expect(m.get('Keeper-linux-amd64.deb')).toBe('b'.repeat(64));
    expect(m.get('Keeper-linux-x86_64.rpm')).toBe('c'.repeat(64));
    expect(m.has('short.txt')).toBe(false);
    expect(m.size).toBe(3);
  });

  it('matches exact file names only', () => {
    expect(checksumFor(SUMS, 'Keeper-mac-arm64.dmg')).toBe(A);
    expect(checksumFor(SUMS, 'Keeper-mac-x64.dmg')).toBeUndefined();
    expect(checksumFor(SUMS, 'arm64.dmg')).toBeUndefined();
  });

  it('accepts a matching file and refuses everything else with a clear message', () => {
    expect(checksumProblem(SUMS, 'Keeper-mac-arm64.dmg', A.toUpperCase())).toBeNull();
    expect(checksumProblem(SUMS, 'Keeper-mac-arm64.dmg', 'e'.repeat(64))).toMatch(/does not match/);
    expect(checksumProblem(SUMS, 'Keeper-mac-x64.dmg', A)).toMatch(/not listed/);
    expect(checksumProblem(undefined, 'Keeper-mac-arm64.dmg', A)).toMatch(/no SHA256SUMS\.txt/);
  });
});

describe('code signature requirements', () => {
  const selfSigned = 'Executable=/Applications/Keeper.app/Contents/MacOS/Keeper\n'
    + 'designated => identifier "io.github.ashfordeou.keeper" and certificate leaf = H"0123456789abcdef0123456789abcdef01234567"\n';
  const adHoc = 'Executable=/Applications/Keeper.app/Contents/MacOS/Keeper\n# designated => cdhash H"0123456789abcdef0123456789abcdef01234567"\n';
  const developerId = 'designated => anchor apple generic and identifier "io.github.ashfordeou.keeper" and (certificate leaf[field.1.2.840.113635.100.6.1.9] /* exists */ or certificate 1[field.1.2.840.113635.100.6.2.6] /* exists */ and certificate leaf[field.1.2.840.113635.100.6.1.13] /* exists */ and certificate leaf[subject.OU] = ABCDE12345)';

  it('reads the designated requirement from codesign -d -r- output', () => {
    expect(designatedRequirement(selfSigned)).toBe('identifier "io.github.ashfordeou.keeper" and certificate leaf = H"0123456789abcdef0123456789abcdef01234567"');
    expect(designatedRequirement(developerId)).toMatch(/^anchor apple generic and identifier/);
    expect(designatedRequirement('Executable=/x\n')).toBeUndefined();
  });

  it('tells an ad-hoc signature (cdhash) from a certificate', () => {
    expect(isAdHocRequirement(designatedRequirement(adHoc))).toBe(true);
    expect(isAdHocRequirement('cdhash H"0123"')).toBe(true);
    expect(isAdHocRequirement(undefined)).toBe(true);
    expect(isAdHocRequirement(designatedRequirement(selfSigned))).toBe(false);
    expect(isAdHocRequirement(designatedRequirement(developerId))).toBe(false);
  });
});

describe('the bridge from "Keeper Self-Signed" to the Developer ID', () => {
  const selfSigned = 'identifier "io.github.ashfordeou.keeper" and certificate leaf = H"e0517bd6aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"';
  const devIdApp = 'anchor apple generic and certificate leaf[field.1.2.840.113635.100.6.1.13] exists and certificate leaf[subject.OU] = "D69G45342Y" and identifier "io.github.ashfordeou.keeper"';

  it('pins Ashforde\'s team, the Developer ID Application marker and Keeper\'s identifier, written once', () => {
    expect(APPLE_TEAM_ID).toBe('D69G45342Y');
    expect(DEVELOPER_ID_APP_REQUIREMENT).toBe(devIdApp);
    expect(DEVELOPER_ID_SIGNER).toBe('anchor apple generic and certificate leaf[field.1.2.840.113635.100.6.1.13] exists and certificate leaf[subject.OU] = "D69G45342Y"');
  });

  it('a self-signed copy accepts its own signer or the Developer ID, and nothing else', () => {
    expect(updateRequirements(selfSigned)).toEqual([selfSigned, devIdApp]);
  });

  it('a Developer ID copy keeps its own requirement (and the same team\'s)', () => {
    const own = 'anchor apple generic and identifier "io.github.ashfordeou.keeper" and (certificate leaf[field.1.2.840.113635.100.6.1.9] /* exists */ or certificate 1[field.1.2.840.113635.100.6.2.6] /* exists */ and certificate leaf[field.1.2.840.113635.100.6.1.13] /* exists */ and certificate leaf[subject.OU] = D69G45342Y)';
    expect(updateRequirements(own)).toEqual([own, devIdApp]);
    // The bridge rule is not added twice.
    expect(updateRequirements(devIdApp)).toEqual([devIdApp]);
  });

  it('an ad-hoc copy has no requirement to add the bridge to', () => {
    expect(updateRequirements('cdhash H"0123"')).toEqual([]);
    expect(updateRequirements(undefined)).toEqual([]);
  });

  it('every accepted requirement names Keeper and a certificate: no other team, app or ad-hoc build', () => {
    for (const r of updateRequirements(selfSigned)) {
      expect(r).toContain('identifier "io.github.ashfordeou.keeper"');
      expect(r).toMatch(/certificate leaf/);
      expect(r).not.toMatch(/\bor\b/);
    }
  });

  it('tells self-signed copies when the next version moves to the Developer ID', () => {
    const notes = `${DEVELOPER_ID_RELEASE_MARKER}\n\n### Fixed\n- x`;
    expect(releaseSignedWithDeveloperId(notes)).toBe(true);
    expect(releaseSignedWithDeveloperId('### Fixed\n- x')).toBe(false);
    expect(releaseSignedWithDeveloperId(undefined)).toBe(false);
    expect(isSignerChange({ platform: 'darwin', developerId: false, notes })).toBe(true);
    expect(isSignerChange({ platform: 'darwin', developerId: true, notes })).toBe(false);
    expect(isSignerChange({ platform: 'darwin', developerId: false, notes: '### Fixed' })).toBe(false);
    expect(isSignerChange({ platform: 'win32', developerId: false, notes })).toBe(false);
  });
});
