// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
import { describe, expect, it } from 'vitest';
import { checksumFor, checksumProblem, designatedRequirement, isAdHocRequirement, parseChecksums } from '../core/update-verify';

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
