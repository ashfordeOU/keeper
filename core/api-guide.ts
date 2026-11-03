// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Guided fixes between the main process and the window.

import type { AutoFixPreview, AutoFixResult, FindingDetails, FindingState, FindingView, GuideFlow, GuideSummary } from './guide/types';

export interface GuideList {
  findings: FindingView[];
  summary: GuideSummary;
  checkedAt?: number;
  platform: 'darwin' | 'win32' | 'linux';
}

export interface GuideApi {
  /** everything found, with what the person decided (cached; refresh to re-check) */
  list(): Promise<GuideList>;
  /** checks again (all checkers, or one) */
  refresh(source?: string): Promise<GuideList>;
  summary(): Promise<GuideSummary>;
  setState(id: string, patch: Partial<FindingState> | null): Promise<GuideList>;
  /** the same change to several findings (Snooze selected; null brings them back) */
  setStates(ids: string[], patch: Partial<FindingState> | null): Promise<GuideList>;
  /** Trust: these exact items are known and fine; each comes back if it changes */
  trust(ids: string[]): Promise<GuideList>;
  untrust(id: string): Promise<GuideList>;
  /** what exactly was found (gathered when a row is opened) */
  details(id: string): Promise<FindingDetails | null>;
  /** Show in Finder / Explorer ('file'), or the browser's page for an extension */
  reveal(id: string, how: 'file' | 'extension'): Promise<{ ok: boolean; message?: string }>;
  /** what an automatic fix will change, before it runs */
  preview(id: string): Promise<AutoFixPreview>;
  apply(id: string): Promise<AutoFixResult>;
  undo(id: string): Promise<AutoFixResult>;
  /** opens the settings page a fix or step points at (by finding id, or by link topic) */
  open(target: { id?: string; topic?: string }): Promise<{ ok: boolean; label?: string; message?: string }>;
  /** re-checks one finding after the person did the steps */
  verify(id: string): Promise<'done' | 'still-needed'>;
  /** the small always-on-top window that keeps the steps visible while the person is in System Settings */
  mini(id: string | null): Promise<void>;
  flows(): Promise<GuideFlow[]>;
  /** a finding (or a flow, as flow:<id>) by id */
  get(id: string): Promise<FindingView | null>;
  /** "How do I…?" */
  howTo(query: string): Promise<{ id: string; title: string; area: string }[]>;
  /** plain-English help from the AI chosen in Keeper (optional) */
  explain(id: string, mode: 'explain' | 'walk'): Promise<{ ok: boolean; text: string }>;
  /** the window came back to the front: re-check fixes the person started */
  focus(): void;
}
