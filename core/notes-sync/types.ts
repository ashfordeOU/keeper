// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Notes Everywhere: the shapes shared by the hub, the sync engine and every
// connector. No Node modules here: the window reads these types too.

/** How much a connector can do, said honestly. */
export type Capability = 'two-way' | 'import-limited-write' | 'import-only';

export type ConnectorKind =
  | 'folder' | 'joplin' | 'joplin-files' | 'standardnotes' | 'standardnotes-sync' | 'notesnook' | 'onenote' | 'notion'
  | 'simplenote' | 'evernote' | 'applenotes' | 'bear' | 'sticky' | 'keep' | 'samsung' | 'island';

export interface ConnectorField {
  key: string;
  label: string;
  type: 'text' | 'secret' | 'folder' | 'file' | 'url';
  placeholder?: string;
  optional?: boolean;
  help?: string;
}

export interface ConnectorDef {
  kind: ConnectorKind;
  /** the app it connects to, e.g. "Joplin" */
  name: string;
  /** one short line: how Keeper reaches it */
  how: string;
  capability: Capability;
  /** only on these systems (empty: everywhere) */
  platforms?: string[];
  fields: ConnectorField[];
  /** plain-English limits shown next to the badge */
  limits: string[];
  /** the folder under the hub where its notes are mirrored */
  hubFolder: string;
}

export interface Attachment {
  name: string;
  mime?: string;
  /** sha-256 of the bytes, hex; the file is stored once under this name */
  hash?: string;
  /** the bytes, when a connector just read them */
  data?: Uint8Array;
  /** the connector's own id for it (Evernote's md5, a Joplin resource id) */
  sourceRef?: string;
}

/** A note as a connector sees it. Body is Markdown. */
export interface RemoteNote {
  sourceId: string;
  title: string;
  body: string;
  tags: string[];
  created?: number;
  modified?: number;
  /** notebook / folder path inside the app, "/"-separated */
  folder?: string;
  /** the app's own version marker: etag, updated time, change counter */
  version?: string;
  /** locked or encrypted in the app: the body is never read or kept */
  locked?: boolean;
  /** in the app's trash */
  trashed?: boolean;
  attachments?: Attachment[];
  /** frontmatter properties the app's file carried (plain folders) */
  props?: Record<string, unknown>;
}

/** Where a hub note lives in one connected app, and what it looked like when last synced. */
export interface SourceLink {
  /** connector instance id */
  connector: string;
  app: ConnectorKind;
  id: string;
  folder?: string;
  version?: string;
  /** hash of the note's text at the last sync: the merge base */
  hash?: string;
  /** hash of the tags at the last sync */
  tagsHash?: string;
  synced?: number;
}

/** A note in the hub folder (Markdown + YAML properties). */
export interface HubNote {
  keeperId: string;
  title: string;
  body: string;
  tags: string[];
  created: number;
  modified: number;
  sources: SourceLink[];
  locked?: boolean;
  attachments?: { name: string; hash: string; mime?: string }[];
  /** other properties found in the file, kept as they were */
  extra?: Record<string, unknown>;
  /** path inside the hub, "/"-separated (set by the reader) */
  rel?: string;
}

export type PlanAction =
  | 'add' // new in the app: copy into the hub
  | 'update' // changed in the app: update the hub
  | 'update-app' // changed in the hub: write back to the app
  | 'add-app' // in the hub, not yet in the app: create there
  | 'merge' // changed on both sides, merged cleanly: update both
  | 'conflict' // changed on both sides in the same place: keep both, ask
  | 'trash' // gone from the app: move the hub copy to Keeper's notes trash
  | 'delete-app' // deleted in the hub: delete in the app (only after you confirm)
  | 'unlink' // gone from the app but changed in the hub: keep the hub copy
  | 'held' // changed in the hub but write-back is off: nothing sent
  | 'locked'; // locked in the app: listed, never copied

export interface PlanItem {
  action: PlanAction;
  keeperId?: string;
  sourceId?: string;
  title: string;
  /** a short reason, e.g. "changed in Joplin" */
  why: string;
  /** the hub note after this step */
  hub?: HubNote;
  /** what to send to the app */
  app?: RemoteNote;
  /** conflict: the app's text that lost, kept as a conflict copy */
  theirs?: { title: string; body: string };
  /** the merge base, for the side-by-side view */
  base?: string;
  /** a possible duplicate already in the hub (from another app) */
  duplicateOf?: string;
  /** needs your yes before it runs (deletes in the app) */
  needsConfirm?: boolean;
}

export interface PlanCounts {
  add: number;
  update: number;
  updateApp: number;
  addApp: number;
  merge: number;
  conflicts: number;
  trash: number;
  deleteApp: number;
  held: number;
  locked: number;
  unchanged: number;
}

export interface SyncPlan {
  connector: string;
  made: number;
  items: PlanItem[];
  counts: PlanCounts;
  /** "Would add 412, update 3, conflicts 0" */
  summary: string;
}

export interface ConflictEntry {
  id: string;
  keeperId: string;
  /** the conflict copy in the hub */
  copyId: string;
  connector: string;
  app: ConnectorKind;
  title: string;
  base: string;
  mine: string;
  theirs: string;
  at: number;
}

export interface HistoryEntry {
  at: number;
  keeperId: string;
  title: string;
  app?: ConnectorKind | 'hub';
  connector?: string;
  action: 'added' | 'updated' | 'merged' | 'conflict' | 'trashed' | 'restored' | 'written' | 'deleted-in-app' | 'edited' | 'linked' | 'merged-duplicate' | 'copied';
  /** e.g. "+3 −1 lines" */
  summary?: string;
  /** content hashes before and after, to show what changed */
  before?: string;
  after?: string;
}
