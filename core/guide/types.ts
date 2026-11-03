// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Guided fixes: one shape for everything Keeper asks the person to do about
// space, storage, security, privacy, performance, the network, backups and
// updates — what is wrong, why it matters, and how to fix it (Keeper does it,
// opens the right settings page and walks through it, or explains the steps).

export type Area = 'space' | 'storage' | 'security' | 'privacy' | 'performance' | 'network' | 'backup' | 'updates';
export const AREAS: Area[] = ['space', 'storage', 'security', 'privacy', 'performance', 'network', 'backup', 'updates'];

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

/** Simple generic drawings of a settings window, never copies of real screenshots. */
export type DiagramId = 'settings-list' | 'settings-toggle' | 'settings-button' | 'keeper-page';

export interface GuideStep {
  /** short instruction; {term} placeholders are filled with the OS's own words in the person's language */
  text: string;
  /** an OS term (see strings.ts) shown highlighted, e.g. 'mac.camera' */
  term?: string;
  diagram?: DiagramId;
  /** a deep link topic the step can open (see links.ts) */
  link?: string;
}

export type Fix =
  /** Keeper does it: previewed, confirmed, journaled, undone where possible */
  | { kind: 'auto'; action: string; label: string; needsAdmin?: boolean }
  /** open the exact settings page, then walk through it */
  | { kind: 'open'; link: string; label?: string; steps: GuideStep[] }
  /** steps only (nothing to open) */
  | { kind: 'manual'; steps: GuideStep[] }
  /** a Keeper page, with the item to look at highlighted */
  | { kind: 'page'; route: { name: string; arg?: string; q?: string }; label?: string; highlight?: string; steps?: GuideStep[] };

export interface Finding {
  /** stable across checks, e.g. 'space:trash' or 'protection:firewall' */
  id: string;
  /** which checker produced it (see registerFindings) */
  source: string;
  area: Area;
  severity: Severity;
  title: string;
  /** why it matters, in plain English */
  why: string;
  /** e.g. "frees 12 GB" */
  impact?: string;
  /** bytes it frees, for sorting space findings by what they are worth */
  impactBytes?: number;
  fix: Fix;
  /** what exactly was found, in a line (a path, a name, an id) */
  detail?: string;
  /** the exact thing the finding is about: what details are gathered for and what Trust remembers */
  subject?: Subject;
  /** similar findings shown together when there are several ("4 browser extensions with broad access") */
  group?: { key: string; one: string; many: string };
  /** how sure Keeper is that this needs doing */
  confidence?: 'sure' | 'likely' | 'unsure';
  /** a page of Keeper's documentation (doc#anchor) or a web address that explains it */
  learnMore?: string;
}

/** Something a finding is about, for its details, its actions and Trust. */
export type Subject =
  | {
    kind: 'login-item';
    /** the file that registers it (a plist, a .desktop file, a unit, a registry key) */
    path: string;
    /** launch-agent, launch-daemon, autostart, systemd-user, run-key… */
    where: string;
    name: string;
    /** the launchd label or unit name */
    label?: string;
    /** the program it runs, with its arguments */
    program?: string;
    signed?: boolean;
    /** who signed it: "Developer ID Application: Docker Inc (9BNSXJN65R)", an Authenticode publisher */
    signer?: string;
    team?: string;
    notarized?: boolean;
    /** the program's code hash (codesign CDHash) or file hash; changes with a new program */
    codeHash?: string;
    /** a hash of the registering file; changes when what it runs changes */
    contentHash?: string;
    firstSeen?: number;
    /** recognised from the table of common tools (core/security/known-tools.ts) */
    tool?: { id: string; name: string; maker: string; detail?: string; verified?: boolean };
  }
  | {
    kind: 'extension';
    browser: string;
    profile: string;
    /** the profile's folder */
    profileDir?: string;
    id: string;
    name: string;
    version?: string;
    permissions: string[];
    hostPermissions: string[];
    fromStore?: boolean;
    engine?: 'chromium' | 'firefox' | 'webkit';
  }
  | {
    kind: 'certificate';
    /** where it is: a keychain, a certificate store or a folder */
    store: string;
    name: string;
    sha1?: string;
    sha256?: string;
    /** the file it came from (Linux) */
    file?: string;
  };

/** Details gathered when a row is opened: plain sections of label and value. */
export interface FindingDetails {
  sections: { title: string; rows: { label: string; value: string; mono?: boolean; url?: string }[]; text?: string; mono?: boolean }[];
  /** why it is on the list, in a sentence or two */
  why: string;
  /** how sure Keeper is, in words */
  confidence?: string;
  learnMore?: { label: string; url: string };
  /** which extra actions make sense for it */
  actions: { reveal?: boolean; extensionPage?: string };
}

/** What the person did with a finding; kept on disk. */
export interface FindingState {
  snoozedUntil?: number;
  ignored?: boolean;
  /** fixed and checked */
  doneAt?: number;
  /** the fix was started; checked again when the person comes back */
  startedAt?: number;
  /** the person said it is theirs and fine: remembered for this exact item (its fingerprint) */
  trusted?: { fp: string; at: number; title?: string };
}

export interface AutoFixPreview {
  summary: string;
  items: { label: string; detail?: string }[];
  bytes?: number;
  needsAdmin?: boolean;
  undoable: boolean;
  warning?: string;
  /** the fix only opens something (nothing to undo) */
  opensOnly?: boolean;
}

export interface AutoFixResult {
  ok: boolean;
  message: string;
  /** set when the change can be undone */
  undoable?: boolean;
  /** started, not finished (the person does the last step, e.g. Remove in the browser): checked again when they come back */
  pending?: boolean;
}

/** A finding as the interface shows it: with what the person did, and whether it is still needed. */
export interface FindingView extends Finding {
  state: FindingState;
  status: 'open' | 'snoozed' | 'ignored' | 'done' | 'trusted';
  /** the item's fingerprint (what Trust remembers) */
  fp?: string;
  /** trusted before, but the item has changed since (a new program, new permissions, another signer) */
  changed?: boolean;
}

/** A guided flow that is not tied to a problem ("encrypt my disk", "back up my photos"). */
export interface GuideFlow {
  id: string;
  title: string;
  area: Area;
  why: string;
  /** per OS; 'all' when the same everywhere */
  fix: Partial<Record<'darwin' | 'win32' | 'linux' | 'all', Fix>>;
}

export interface GuideSummary {
  open: number;
  byArea: Partial<Record<Area, number>>;
  /** the most important open finding, for the Island and the sidebar */
  top?: { id: string; title: string; severity: Severity };
  checkedAt?: number;
}
