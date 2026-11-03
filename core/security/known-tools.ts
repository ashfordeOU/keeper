// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Things that start at login which most people recognise: developer tools
// (Docker, Homebrew services, a GitHub Actions runner, Tailscale, 1Password…)
// and common app helpers. A recognised item signed by its maker is said by
// name and counts as low; one that only borrows a well-known name is not
// trusted for it. This is a table of data: add a row to recognise more.

import type { Severity } from './types';

export interface KnownTool {
  id: string;
  /** what to call it; $1… are filled from the label match */
  name: string;
  maker: string;
  /** matched against the label or file name without its extension (com.docker.socket) */
  label?: RegExp;
  /** matched against the program it runs */
  program?: RegExp;
  /** who must have signed it for Keeper to say it is really theirs (macOS Developer ID / Windows publisher) */
  signer?: RegExp;
  /** a web page about it */
  learnMore?: string;
}

export const KNOWN_TOOLS: KnownTool[] = [
  { id: 'github-runner', name: 'GitHub Actions runner', maker: 'GitHub (your own self-hosted runner)', label: /^actions\.runner\./, program: /(^|\/)(runsvc\.sh|Runner\.Listener)(\s|$)/, learnMore: 'https://docs.github.com/en/actions/hosting-your-own-runners/managing-self-hosted-runners/configuring-the-self-hosted-runner-application-as-a-service' },
  { id: 'homebrew', name: 'Homebrew service: $1', maker: 'Homebrew', label: /^homebrew\.mxcl\.(.+)$/, program: /^(\/opt\/homebrew|\/usr\/local\/(Cellar|opt)|\/home\/linuxbrew\/\.linuxbrew)\//, learnMore: 'https://docs.brew.sh/Manpage#services-subcommand' },
  { id: 'docker', name: 'Docker Desktop', maker: 'Docker Inc', label: /^(com\.docker\.|docker(\.service|\.socket)?$|Docker Desktop$)/i, program: /\/Docker\.app\/|\\Docker\\Docker Desktop\.exe|(^|\/)com\.docker\./, signer: /Docker Inc/i, learnMore: 'https://docs.docker.com/desktop/' },
  { id: 'tailscale', name: 'Tailscale', maker: 'Tailscale Inc', label: /^((com|io)\.tailscale\.|tailscaled?$|Tailscale$)/i, program: /Tailscale/i, signer: /Tailscale/i },
  { id: '1password', name: '1Password', maker: 'AgileBits (1Password)', label: /^(com\.(1password|agilebits)\.|1Password)/i, program: /1Password/i, signer: /AgileBits|1Password/i },
  { id: 'google-updater', name: 'Google software updater', maker: 'Google LLC', label: /^com\.google\.(keystone|GoogleUpdater|GoogleDrive)/i, program: /Google(Updater|SoftwareUpdate)|Keystone/i, signer: /Google LLC/i },
  { id: 'microsoft', name: 'Microsoft app helper', maker: 'Microsoft Corporation', label: /^com\.microsoft\./, program: /Microsoft/i, signer: /Microsoft Corporation/i },
  { id: 'zoom', name: 'Zoom', maker: 'Zoom Video Communications', label: /^us\.zoom\./, program: /zoom\.us/i, signer: /Zoom Video Communications/i },
  { id: 'dropbox', name: 'Dropbox', maker: 'Dropbox, Inc', label: /^com\.dropbox\./i, program: /Dropbox/i, signer: /Dropbox/i },
  { id: 'adobe', name: 'Adobe app helper', maker: 'Adobe Inc', label: /^com\.adobe\./i, program: /Adobe/i, signer: /Adobe/i },
  { id: 'jetbrains', name: 'JetBrains Toolbox', maker: 'JetBrains', label: /^com\.jetbrains\./i, program: /JetBrains/i, signer: /JetBrains/i },
  { id: 'cloudflare', name: 'Cloudflare WARP', maker: 'Cloudflare', label: /^com\.cloudflare\./i, program: /Cloudflare/i, signer: /Cloudflare/i },
  { id: 'orbstack', name: 'OrbStack', maker: 'Orbital Labs', label: /^dev\.orbstack\./i, program: /OrbStack/i },
  { id: 'ollama', name: 'Ollama', maker: 'Ollama', label: /^(com\.)?ollama/i, program: /Ollama/i },
  { id: 'logitech', name: 'Logitech device helper', maker: 'Logitech', label: /^com\.logi(tech)?\./i, program: /Logi/i, signer: /Logitech/i },
  { id: 'karabiner', name: 'Karabiner-Elements', maker: 'Fumihiko Takayama', label: /^org\.pqrs\./i, program: /Karabiner/i, signer: /Takayama/i },
  { id: 'virtualbox', name: 'VirtualBox', maker: 'Oracle', label: /^org\.virtualbox\./i, program: /VirtualBox/i, signer: /Oracle/i },
  { id: 'parallels', name: 'Parallels Desktop', maker: 'Parallels', label: /^com\.parallels\./i, program: /Parallels/i, signer: /Parallels/i },
  { id: 'steam', name: 'Steam', maker: 'Valve', label: /^com\.valvesoftware\./i, program: /Steam/i, signer: /Valve/i },
  { id: 'syncthing', name: 'Syncthing', maker: 'The Syncthing Foundation', label: /^syncthing/i, program: /syncthing/i },
  { id: 'keeper', name: 'Keeper', maker: 'Ashforde', label: /^(org|com)\.ashforde\./i, program: /Keeper/i, signer: /Ashforde/i },
];

export interface StartupInput {
  /** the file name (com.docker.socket.plist) or entry name */
  name: string;
  label?: string;
  program?: string;
  signed?: boolean;
  signer?: string;
  notarized?: boolean;
}

export interface Recognised {
  id: string;
  name: string;
  maker: string;
  /** e.g. "for ashfordeOU/arksa · runner arksa-mac-1" */
  detail?: string;
  /** signed by the maker the table expects (or the table expects no signature) */
  verified: boolean;
  /** named like a known tool but signed by someone else */
  mismatch?: boolean;
  learnMore?: string;
}

/** The label without the file's extension. */
export function labelOf(i: Pick<StartupInput, 'name' | 'label'>): string {
  return i.label || i.name.replace(/\.(plist|service|timer|socket|desktop|lnk)$/i, '');
}

/** "Developer ID Application: Docker Inc (9BNSXJN65R)" → { name: "Docker Inc", team: "9BNSXJN65R" }. */
export function signerName(signer?: string): { name?: string; team?: string } {
  if (!signer) return {};
  const m = signer.match(/^(?:Developer ID Application|Apple Development|Apple Distribution|Mac Developer|3rd Party Mac Developer Application):\s*(.+?)(?:\s*\(([A-Z0-9]{10})\))?$/);
  if (m) return { name: m[1], team: m[2] };
  return { name: signer.replace(/^CN=/, '').split(',')[0].trim() };
}

/** "actions.runner.ashfordeOU-arksa.arksa-mac-1" → the repository (or organisation) and the runner's name. */
export function runnerOf(label: string): { repo?: string; runner?: string } {
  const m = label.match(/^actions\.runner\.([^.]+)\.(.+)$/);
  if (!m) return {};
  const scope = m[1];
  const dash = scope.indexOf('-');
  // The service is named owner-repo; GitHub owners rarely contain a dash, so the first one splits them.
  return { repo: dash > 0 ? `${scope.slice(0, dash)}/${scope.slice(dash + 1)}` : scope, runner: m[2] };
}

/** Which known tool an item that starts automatically is, if any. */
export function recognise(i: StartupInput, table: KnownTool[] = KNOWN_TOOLS): Recognised | undefined {
  const label = labelOf(i);
  for (const t of table) {
    const byLabel = t.label ? label.match(t.label) : null;
    const byProgram = !!(t.program && i.program && t.program.test(i.program));
    if (!byLabel && !byProgram) continue;
    const name = byLabel ? t.name.replace(/\$(\d)/g, (_x, n: string) => byLabel[Number(n)] ?? '') : t.name.replace(/:?\s*\$\d/g, '');
    let detail: string | undefined;
    if (t.id === 'github-runner') {
      const r = runnerOf(label);
      if (!r.repo && !byProgram) continue;
      detail = r.repo ? `for ${r.repo}${r.runner ? ` · runner ${r.runner}` : ''}` : undefined;
    }
    let verified: boolean;
    let mismatch = false;
    if (t.signer) {
      verified = !!(i.signed && i.signer && t.signer.test(i.signer));
      mismatch = !!(i.signer && !t.signer.test(i.signer)) || i.signed === false;
    } else verified = byProgram || !!byLabel;
    return { id: t.id, name: t.id === 'github-runner' && detail ? `GitHub Actions runner ${detail.split(' · ')[0]}` : name, maker: t.maker, detail, verified, ...(mismatch ? { mismatch } : {}), learnMore: t.learnMore };
  }
  return undefined;
}

export interface StartupVerdict {
  severity: Severity;
  title: string;
  why: string;
  confidence: 'sure' | 'likely' | 'unsure';
  tool?: Recognised;
}

/** How an item that newly starts automatically is described, and how much it matters. */
export function startupVerdict(i: StartupInput): StartupVerdict {
  const tool = recognise(i);
  const who = signerName(i.signer).name;
  const label = labelOf(i);
  const unknownWhy = 'Something new was set to run whenever the computer starts or you sign in. If you just installed something, this is probably it.';
  if (tool && !tool.mismatch) {
    const runner = tool.id === 'github-runner';
    return {
      severity: 'low',
      title: `${tool.name} starts automatically`,
      why: runner
        ? 'A self-hosted GitHub Actions runner: it runs jobs from that repository on this computer. If you set it up, press Trust.'
        : `${tool.maker} makes it${tool.verified && who ? ` and signed it (${who})` : ''}. It was set to start by itself, which is normal for it. Press Trust if you use it.`,
      confidence: 'unsure',
      tool,
    };
  }
  if (tool?.mismatch) {
    return {
      severity: 'medium',
      title: `Something new runs at login and is named like ${tool.name}`,
      why: `It is named like ${tool.name}, but ${i.signed === false ? 'it is not signed' : `it is signed by ${who ?? 'someone else'}`}, not by ${tool.maker}. Take a look unless you know where it came from.`,
      confidence: 'likely',
      tool,
    };
  }
  if (i.signed && who) {
    return {
      severity: 'low',
      title: `Something new runs at login: ${label} (${who})`,
      why: `${unknownWhy} It is signed by ${who}${i.notarized ? ' and checked by Apple' : ''}.`,
      confidence: 'unsure',
    };
  }
  return {
    severity: i.signed === false ? 'medium' : 'low',
    title: `Something new runs at login: ${label}`,
    why: i.signed === false ? `${unknownWhy} It is not signed, so Keeper cannot tell who made it; take a look if you did not just install something.` : unknownWhy,
    confidence: i.signed === false ? 'likely' : 'unsure',
  };
}
