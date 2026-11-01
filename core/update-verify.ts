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
