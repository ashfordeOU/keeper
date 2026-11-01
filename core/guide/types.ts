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
}

/** What the person did with a finding; kept on disk. */
export interface FindingState {
  snoozedUntil?: number;
  ignored?: boolean;
  /** fixed and checked */
  doneAt?: number;
  /** the fix was started; checked again when the person comes back */
  startedAt?: number;
}

export interface AutoFixPreview {
  summary: string;
  items: { label: string; detail?: string }[];
  bytes?: number;
  needsAdmin?: boolean;
  undoable: boolean;
  warning?: string;
}

export interface AutoFixResult {
  ok: boolean;
  message: string;
  /** set when the change can be undone */
  undoable?: boolean;
}

/** A finding as the interface shows it: with what the person did, and whether it is still needed. */
export interface FindingView extends Finding {
  state: FindingState;
  status: 'open' | 'snoozed' | 'ignored' | 'done';
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
