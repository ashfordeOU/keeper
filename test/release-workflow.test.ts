// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The release workflow's promises: betas (tags with a hyphen) become GitHub pre-releases and
// never reach a package manager; the Store package stays a workflow artifact. See docs/BETA.md.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// js-yaml ships no type declarations; only load() is used.
const yaml = createRequire(import.meta.url)('js-yaml') as { load(text: string): unknown };

const ROOT = path.resolve(__dirname, '..');
type Step = { id?: string; name?: string; uses?: string; with?: Record<string, unknown>; run?: string; env?: Record<string, string>; if?: string };
type Job = { if?: string; needs?: string | string[]; permissions?: Record<string, string>; strategy?: { matrix?: unknown }; steps?: Step[] };
const wf = yaml.load(readFileSync(path.join(ROOT, '.github/workflows/release.yml'), 'utf8')) as { jobs: Record<string, Job> };

/** Jobs that publish somewhere other than the GitHub release itself. */
const CHANNELS = ['homebrew', 'manifests', 'winget', 'chocolatey', 'snap', 'aur', 'npm', 'pages'];

describe('release workflow', () => {
  it('marks versions with a hyphen as pre-releases', () => {
    const release = wf.jobs.release;
    const version = wf.jobs.tag.steps?.find((s) => s.run?.includes('prerelease='));
    expect(version?.run).toMatch(/\*-\*\) prerelease=true/);
    const gh = release.steps?.find((s) => s.uses?.startsWith('softprops/action-gh-release'));
    expect(String(gh?.with?.prerelease)).toContain("steps.meta.outputs.prerelease == 'true'");
  });

  it.each(CHANNELS)('the %s channel never runs for a pre-release', (name) => {
    const job = wf.jobs[name];
    expect(job, name).toBeTruthy();
    expect(job.if).toContain("needs.release.outputs.prerelease == 'false'");
  });

  it('no publishing job is left unchecked', () => {
    const known = new Set(['tag', 'build', 'release', 'msstore', 'website', ...CHANNELS]);
    expect(Object.keys(wf.jobs).filter((j) => !known.has(j))).toEqual([]);
  });

  it('redeploys the website after a published release, publishing nothing itself', () => {
    const web = wf.jobs.website as { needs?: string[]; if?: string; permissions?: Record<string, string>; steps?: { run?: string }[] };
    expect(web.needs).toEqual(['release', 'pages']);
    expect(web.if).toContain("needs.release.result == 'success'");
    expect(web.permissions).toEqual({ actions: 'write' });
    expect(web.steps?.map((s) => s.run ?? '').join('\n')).toBe('gh workflow run site.yml --ref main --repo "$GITHUB_REPOSITORY"');
  });

  it('builds the Store package only when a version is being built', () => {
    expect(wf.jobs.msstore.needs).toBe('tag');
    expect(wf.jobs.msstore.if).toContain("needs.tag.outputs.build == 'true'");
  });

  it('keeps the Store package out of the GitHub release', () => {
    const upload = wf.jobs.msstore.steps?.find((s) => s.uses?.startsWith('actions/upload-artifact'));
    // The release job downloads "keeper-*" artifacts; the .msix must not match that pattern.
    expect(String(upload?.with?.name)).not.toMatch(/^keeper-/);
    expect(JSON.stringify(wf.jobs.msstore.steps)).not.toContain('action-gh-release');
  });
  it('publishes SHA256SUMS.txt covering every file in the release (the updater refuses a release without it)', () => {
    const steps = wf.jobs.release.steps ?? [];
    const at = (pred: (s: (typeof steps)[number]) => boolean) => steps.findIndex(pred);
    const sums = at((s) => /SHA256SUMS\.txt/.test(s.run ?? '') && /sha256sum/.test(s.run ?? ''));
    expect(sums).toBeGreaterThan(-1);
    // Every file in artifacts/ (the downloaded keeper-* builds and the npm package), not a hand-picked list.
    expect(steps[sums].run).toMatch(/cd artifacts && sha256sum -- \* > SHA256SUMS\.txt/);
    // Everything that lands in artifacts/ comes before the checksums...
    const npm = at((s) => /npm pack .*--pack-destination artifacts/.test(s.run ?? ''));
    const builds = at((s) => s.uses?.startsWith('actions/download-artifact') === true && s.with?.path === 'artifacts');
    for (const i of [npm, builds]) expect(i).toBeGreaterThan(-1);
    expect(Math.max(npm, builds)).toBeLessThan(sums);
    // ...and the release uploads the whole folder, the checksums with it.
    const gh = at((s) => s.uses?.startsWith('softprops/action-gh-release') === true);
    expect(gh).toBeGreaterThan(sums);
    expect(steps[gh].with?.files).toBe('artifacts/*');
    // The name the updater looks for.
    expect(readFileSync(path.join(ROOT, 'core/update-verify.ts'), 'utf8')).toContain("CHECKSUMS_FILE = 'SHA256SUMS.txt'");
  });

  it('releases the systems named in .github/release.json, or in the platforms input', () => {
    const config = JSON.parse(readFileSync(path.join(ROOT, '.github/release.json'), 'utf8')) as { platforms: string[] };
    expect(config.platforms.length).toBeGreaterThan(0);
    for (const p of config.platforms) expect(['mac', 'windows', 'linux']).toContain(p);
    const raw = readFileSync(path.join(ROOT, '.github/workflows/release.yml'), 'utf8');
    expect(raw).toMatch(/workflow_dispatch:[\s\S]*platforms:/);
    const step = wf.jobs.tag.steps?.find((s) => s.id === 'platforms');
    expect(step?.run).toContain('.github/release.json');
    // The build matrix comes from the tag job, so a system left out is not built at all.
    expect(String(wf.jobs.build.strategy?.matrix)).toContain('needs.tag.outputs.matrix');
  });

  it('a release for some systems only publishes nothing for the others', () => {
    const steps = wf.jobs.release.steps ?? [];
    // Only the channels whose files are in SHA256SUMS.txt are rendered.
    expect(steps.find((s) => /render-packaging\.mjs .*--sums/.test(s.run ?? ''))?.run).toContain('--only');
    // apt/dnf need Linux; Windows-only channels need Windows; the Store package needs Windows.
    expect(steps.find((s) => s.id === 'repos')?.if).toContain("needs.tag.outputs.linux == 'true'");
    expect(wf.jobs.msstore.if).toContain("needs.tag.outputs.windows == 'true'");
    const channels = steps.find((s) => s.id === 'channels')?.run ?? '';
    for (const [name, system] of [['winget', 'WINDOWS'], ['choco', 'WINDOWS'], ['aur', 'LINUX'], ['snap', 'LINUX'], ['homebrew', 'MAC']]) {
      expect(channels).toMatch(new RegExp(`channel ${name} .*"\\$${system}"`));
    }
    // A pattern without files (no AppImage) must not stop the GPG signatures or the attestations.
    expect(steps.find((s) => s.name === 'GPG signatures')?.run).toContain('[ -e "$f" ] || continue');
    expect(String(steps.find((s) => s.uses?.startsWith('actions/attest-build-provenance'))?.with?.['subject-path'])).toContain('steps.subjects.outputs.paths');
    // GitHub's "latest" (README links, the apt source, Flathub) follows the tag job's decision.
    expect(String(steps.find((s) => s.uses?.startsWith('softprops/action-gh-release'))?.with?.make_latest)).toContain('needs.tag.outputs.make_latest');
  });

  it('a missing secret skips its channel with a notice and never fails the release', () => {
    const channels = wf.jobs.release.steps?.find((s) => s.id === 'channels');
    expect(channels?.run).toContain('::notice');
    for (const secret of ['COMMIT_SIGNING_KEY', 'HOMEBREW_TAP_TOKEN', 'NPM_TOKEN', 'WINGET_TOKEN', 'CHOCO_API_KEY', 'AUR_SSH_KEY', 'SNAPCRAFT_STORE_CREDENTIALS']) {
      expect(channels?.env?.[secret]).toContain(`secrets.${secret}`);
    }
    for (const name of CHANNELS) expect(wf.jobs[name].if, name).toMatch(/needs\.release\.outputs\.\w+ == 'true'/);
  });

  it('commits to this repository are made as ashfordeOU and signed (never a bot identity)', () => {
    const raw = readFileSync(path.join(ROOT, '.github/workflows/release.yml'), 'utf8');
    expect(raw).not.toContain('github.actor');
    // The cask and bucket go through incoming, where sign-and-land.yml signs them.
    const manifests = JSON.stringify(wf.jobs.manifests.steps);
    expect(manifests).toContain('HEAD:refs/heads/incoming');
    expect(manifests).toContain('gh workflow run sign-and-land.yml --ref incoming');
    expect(manifests).not.toMatch(/HEAD:(refs\/heads\/)?main|push origin main/);
    const land = yaml.load(readFileSync(path.join(ROOT, '.github/workflows/sign-and-land.yml'), 'utf8')) as { on: Record<string, unknown> };
    expect(Object.keys(land.on)).toContain('workflow_dispatch');
    // gh-pages is signed in the job with the same key.
    expect(JSON.stringify(wf.jobs.pages.steps)).toContain('git commit -S');
    for (const job of ['manifests', 'homebrew', 'pages']) expect(JSON.stringify(wf.jobs[job].steps), job).toContain('236818772+ashfordeOU@users.noreply.github.com');
  });

  it('release-check runs CI, the release build and the Verified check', () => {
    const check = yaml.load(readFileSync(path.join(ROOT, '.github/workflows/release-check.yml'), 'utf8')) as { on: Record<string, unknown>; jobs: Record<string, { uses?: string; with?: Record<string, unknown>; steps?: Step[] }> };
    expect(Object.keys(check.on)).toEqual(['workflow_dispatch']);
    expect(check.jobs.ci.uses).toBe('./.github/workflows/ci.yml');
    expect(check.jobs.package.uses).toBe('./.github/workflows/release.yml');
    expect(check.jobs.package.with?.dry_run).toBe(true);
    expect(JSON.stringify(check.jobs.verified.steps)).toContain('signature { isValid state }');
    const ci = yaml.load(readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8')) as { on: Record<string, unknown>; jobs: Record<string, unknown> };
    expect(Object.keys(ci.on)).toContain('workflow_call');
    expect(Object.keys(ci.jobs)).toEqual(expect.arrayContaining(['test', 'native-e2e']));
    // The release build requires every packaged piece.
    expect(JSON.stringify(wf.jobs.build.steps)).toContain("KEEPER_REQUIRE_ALL\":\"1");
  });

  it('the Mac signer comes from release.json\'s macSigning (or the manual input), never from which secrets exist', () => {
    const config = JSON.parse(readFileSync(path.join(ROOT, '.github/release.json'), 'utf8')) as { macSigning?: string };
    expect(['self-signed', 'developer-id']).toContain(config.macSigning ?? 'self-signed');
    const raw = readFileSync(path.join(ROOT, '.github/workflows/release.yml'), 'utf8');
    expect(raw).toMatch(/workflow_dispatch:[\s\S]*mac_signing:/);
    const step = wf.jobs.tag.steps?.find((s) => s.id === 'signing');
    expect(step?.run).toContain('.macSigning // "self-signed"');
    expect(step?.env?.REQUESTED).toContain('inputs.mac_signing');
    // Every expression that reads a Mac signing secret is gated on the signer chosen.
    for (const line of raw.split('\n')) {
      if (/secrets\.(CSC_LINK|CSC_KEY_PASSWORD|KEEPER_DEVELOPER_ID_CERT|KEEPER_DEVELOPER_ID_PASSWORD|APPLE_ID|APPLE_TEAM_ID|APPLE_APP_PASSWORD|APPLE_APP_SPECIFIC_PASSWORD)\b/.test(line)) {
        expect(line).toContain("needs.tag.outputs.mac_signing == 'developer-id'");
      }
      if (/secrets\.KEEPER_SIGNING_(CERT|PASSWORD)\b/.test(line)) expect(line).toContain("needs.tag.outputs.mac_signing == 'self-signed'");
    }
  });

  it('a Developer ID build maps the secrets, notarizes both editions and checks them before upload', () => {
    const steps = wf.jobs.build.steps ?? [];
    const packaging = steps.filter((s) => /npx electron-builder/.test(s.run ?? ''));
    expect(packaging.map((s) => s.name)).toEqual(['Package', 'Offline installer (everything inside)']);
    for (const s of packaging) {
      const env = s.env ?? {};
      expect(env.CSC_LINK).toMatch(/secrets\.KEEPER_DEVELOPER_ID_CERT \|\| secrets\.CSC_LINK/);
      expect(env.CSC_KEY_PASSWORD).toMatch(/secrets\.KEEPER_DEVELOPER_ID_PASSWORD \|\| secrets\.CSC_KEY_PASSWORD/);
      expect(env.APPLE_APP_SPECIFIC_PASSWORD).toMatch(/secrets\.APPLE_APP_PASSWORD \|\| secrets\.APPLE_APP_SPECIFIC_PASSWORD/);
      expect(env.APPLE_ID).toContain('secrets.APPLE_ID');
      expect(env.APPLE_TEAM_ID).toContain('secrets.APPLE_TEAM_ID');
      expect(env.KEEPER_MAC_SIGNING).toContain('needs.tag.outputs.mac_signing');
      // developer-id with a secret missing stops; the signed config is chosen by the signer, not by CSC_LINK.
      expect(s.run).toMatch(/KEEPER_MAC_SIGNING" = developer-id \] && \{[^}]*-z "\$CSC_LINK"[^}]*\}; then[\s\S]*?exit 1/);
      expect(s.run).toContain('if [ "$KEEPER_MAC_SIGNING" = developer-id ] || [ -n "$AZURE_TRUSTED_SIGNING_ACCOUNT" ]; then');
    }
    const cert = steps.find((s) => s.name === 'Signing certificate');
    expect(cert?.run).toMatch(/missing secrets|secrets are missing/);
    expect(cert?.run).toContain('check-mac-signing.mjs --print team');
    const check = steps.findIndex((s) => s.name === 'Check the Developer ID signature');
    expect(check).toBeGreaterThan(steps.findIndex((s) => s.name === 'Offline installer (everything inside)'));
    expect(steps[check].if).toContain("needs.tag.outputs.mac_signing == 'developer-id'");
    expect(steps[check].run).toContain('release/*.dmg');
    expect(check).toBeLessThan(steps.findIndex((s) => s.uses?.startsWith('actions/upload-artifact') === true));
    // The build flag and the release notes follow the same choice.
    expect(JSON.stringify(steps)).toContain("KEEPER_DEVELOPER_ID\":\"${{ matrix.platform == 'darwin' && needs.tag.outputs.mac_signing == 'developer-id'");
    expect(wf.jobs.release.steps?.find((s) => s.name === 'Release notes')?.run).toContain('--mac-signing "$MAC_SIGNING"');
  });
});


describe('remove-old-releases workflow', () => {
  const raw = readFileSync(path.join(ROOT, '.github/workflows/remove-old-releases.yml'), 'utf8');
  const rm = yaml.load(raw) as { on: Record<string, { inputs?: Record<string, { required?: boolean }> }>; permissions: Record<string, string>; jobs: Record<string, Job> };

  it('runs by hand on main only, with versions and a typed confirmation', () => {
    expect(Object.keys(rm.on)).toEqual(['workflow_dispatch']);
    expect(rm.on.workflow_dispatch.inputs?.versions?.required).toBe(true);
    expect(rm.on.workflow_dispatch.inputs?.confirm?.required).toBe(true);
    expect(rm.permissions).toEqual({ contents: 'write' });
    expect(rm.jobs.remove.if).toBe("github.ref == 'refs/heads/main'");
    expect(raw).toContain('[ "$CONFIRM" = "delete" ]');
  });

  it('deletes only pre-releases, only after a stable 1.0.0 or later', () => {
    const run = rm.jobs.remove.steps?.map((s) => s.run ?? '').join('\n') ?? '';
    expect(run).toContain('select(.draft == false and .prerelease == false)');
    expect(run).toContain('No stable release 1.0.0 or later yet');
    expect(run).toContain('is not a pre-release');
    // Only x.y.z-something versions are accepted, so a stable tag can never be named.
    expect(run).toContain('^[0-9]+\\.[0-9]+\\.[0-9]+-[0-9A-Za-z.-]+$');
    expect(run).toContain('gh release delete "$tag" --yes');
    expect(run).not.toContain('--cleanup-tag');
    expect(run).not.toMatch(/git push|git tag -d/);
    // Every version is checked before the first deletion.
    expect(run.indexOf('is not a pre-release')).toBeLessThan(run.indexOf('gh release delete'));
  });

  it('deletes tags only when delete_tags is on, and only the checked pre-release tags', () => {
    const input = rm.on.workflow_dispatch.inputs?.delete_tags as { required?: boolean; default?: boolean; type?: string } | undefined;
    expect(input?.type).toBe('boolean');
    expect(input?.default).toBe(false);
    const run = rm.jobs.remove.steps?.map((s) => s.run ?? '').join('\n') ?? '';
    const deletes = run.match(/gh api -X DELETE [^\n]*/g) ?? [];
    expect(deletes).toEqual(['gh api -X DELETE "repos/$GH_REPO/git/refs/tags/$tag" >/dev/null']);
    const at = run.indexOf('gh api -X DELETE');
    expect(run.lastIndexOf('if [ "$DELETE_TAGS" = "true" ]', at)).toBeGreaterThan(run.indexOf('# The release and its files go'));
    expect(run.indexOf('is not a pre-release')).toBeLessThan(at);
    expect(run).toContain('(tag kept)');
  });
});
