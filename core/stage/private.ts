// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// While Stage mode is on, the Island keeps private things out of sight: the
// clipboard history, the shelf's file names, meeting titles and mirrored
// notifications. Nothing is deleted; it all comes back when Stage ends.

import type { IslandState } from '../api';

export interface IslandStage {
  on: boolean;
  since?: number;
  endsAt?: number;
  countdownEndsAt?: number;
  preset?: string;
  name?: string;
  auto?: boolean;
  /** private items are hidden right now */
  private?: boolean;
}

export function redactIsland(s: IslandState, o: { hidePrivate: boolean; cleanClipboard: boolean; stage: IslandStage }): IslandState {
  const out: IslandState = { ...s, stage: o.stage };
  if (o.cleanClipboard || o.hidePrivate) out.clips = [];
  if (!o.hidePrivate) return out;
  out.shelf = [];
  out.shelves = s.shelves.map((sh) => ({ ...sh, items: [] }));
  out.closedShelves = [];
  out.events = s.events.map((e) => ({ ...e, title: 'Busy', location: undefined, url: undefined }));
  out.alerts = s.alerts.filter((a) => a.kind !== 'notification' && a.kind !== 'download' && a.kind !== 'screenshot' && a.kind !== 'reminder');
  if (s.dueReminders) out.dueReminders = s.dueReminders.map((r) => ({ ...r, title: 'Reminder' }));
  out.agents = s.agents.map((a) => ({ ...a, summary: '', cwd: undefined }));
  return out;
}
