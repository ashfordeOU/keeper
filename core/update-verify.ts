// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Checking a downloaded update before it goes in: the release's SHA256SUMS.txt
// and, on macOS, the new app's code signature against the running app's.
// Pure functions, shared by the updater (electron/services/updater.ts) and its tests.

/** The checksums file every release carries (written by .github/workflows/release.yml). */
export const CHECKSUMS_FILE = 'SHA256SUMS.txt';

/**
 * `sha256sum` / `shasum -a 256` output -> { file name: lowercase hex digest }.
 * Accepts the binary-mode star ("hash *name") and ignores lines that are not checksums.
 */
export function parseChecksums(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/);
    if (!m) continue;
    const name = m[2].replace(/^\.\//, '').split('/').pop() ?? m[2];
    out.set(name, m[1].toLowerCase());
  }
  return out;
}

/** The checksum listed for exactly this file name, if there is one. */
export function checksumFor(text: string, file: string): string | undefined {
  return parseChecksums(text).get(file);
}

/**
 * Whether a downloaded file matches its listed checksum. Returns an error
 * message to show, or null when it matches.
 */
export function checksumProblem(text: string | undefined, file: string, actual: string): string | null {
  if (text === undefined) return `This release has no ${CHECKSUMS_FILE}, so the download cannot be checked; it was not installed`;
  const want = checksumFor(text, file);
  if (!want) return `${file} is not listed in the release's ${CHECKSUMS_FILE}; it was not installed`;
  if (want !== actual.trim().toLowerCase()) return `The download of ${file} does not match the release's checksum (it is damaged or was changed); it was not installed`;
  return null;
}

/**
 * The designated requirement from `codesign -d -r- App.app` output, e.g.
 * `identifier "io.github.ashfordeou.keeper" and certificate leaf = H"…"`.
 * codesign prints it as `designated => …` (on stdout; older versions on stderr).
 */
export function designatedRequirement(output: string): string | undefined {
  for (const line of output.split(/\r?\n/)) {
    const m = line.match(/^\s*designated\s*=>\s*(.+?)\s*$/);
    if (m) return m[1];
  }
  return undefined;
}

/**
 * An ad-hoc signature's requirement pins one build's code hash (`cdhash H"…"`), so
 * nothing else can satisfy it. Such an app (or one with no requirement at all)
 * can only check that the new app's signature is valid; a certificate-based
 * requirement (self-signed or Developer ID) must be met by the new app too.
 */
export function isAdHocRequirement(requirement: string | undefined): boolean {
  return !requirement || /\bcdhash\b/.test(requirement);
}

// ---------------------------------------------------------------- the move to a Developer ID

/** Ashforde OÜ's Apple Developer Team ID: the one place it is written (the release workflow reads it from here too). */
export const APPLE_TEAM_ID = 'D69G45342Y';

/** Keeper's bundle identifier (appId in electron-builder.yml). */
export const KEEPER_BUNDLE_ID = 'io.github.ashfordeou.keeper';

/**
 * Code signed with a "Developer ID Application" certificate (the leaf carries Apple's
 * 1.2.840.113635.100.6.1.13 marker) issued by Apple to Ashforde's team, and to nobody else.
 * The same form as the designated requirement codesign gives a Developer ID build
 * (`anchor apple generic … certificate leaf[subject.OU] = D69G45342Y`); quoting the team is
 * the same value in the requirement language.
 */
export const DEVELOPER_ID_SIGNER = `anchor apple generic and certificate leaf[field.1.2.840.113635.100.6.1.13] exists and certificate leaf[subject.OU] = "${APPLE_TEAM_ID}"`;

/** Keeper itself, signed with Ashforde's Developer ID. */
export const DEVELOPER_ID_APP_REQUIREMENT = `${DEVELOPER_ID_SIGNER} and identifier "${KEEPER_BUNDLE_ID}"`;

/**
 * The requirements a new version of the app may meet to replace this copy: the running
 * copy's own designated requirement, or (the bridge from "Keeper Self-Signed" to the
 * Developer ID) Keeper signed with Ashforde's Developer ID. Nothing else.
 * Empty for an ad-hoc copy, which can only check that the signature is valid.
 * A copy signed with the Developer ID gets the same rule twice over: its own
 * requirement already names the team.
 */
export function updateRequirements(running: string | undefined): string[] {
  if (isAdHocRequirement(running)) return [];
  return [...new Set([running as string, DEVELOPER_ID_APP_REQUIREMENT])];
}

/**
 * Marks a release whose Mac build is signed with the Developer ID (an HTML comment the
 * release workflow writes into the release notes; .github/scripts/release-notes.mjs).
 */
export const DEVELOPER_ID_RELEASE_MARKER = '<!-- keeper:mac-signing=developer-id -->';

/** Whether a release's notes say its Mac build is signed with the Developer ID. */
export function releaseSignedWithDeveloperId(notes: string | null | undefined): boolean {
  return !!notes && notes.includes(DEVELOPER_ID_RELEASE_MARKER);
}

/**
 * Whether installing this release changes who signs Keeper on this Mac: a copy that is
 * not signed with the Developer ID moving to one that is. macOS then asks once more for
 * the keychain and may ask for permissions again.
 */
export function isSignerChange(o: { platform: string; developerId: boolean; notes: string | null | undefined }): boolean {
  return o.platform === 'darwin' && !o.developerId && releaseSignedWithDeveloperId(o.notes);
}
