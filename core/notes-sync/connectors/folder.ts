// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Plain folders of notes: .md and .txt files (vaults, graphs, a folder of
// text notes). Two-way: the file name is the title, the folders are the
// notebook, frontmatter properties are kept as they were.

import { splitFrontmatter } from '../../notes/parse';
import { parseYaml, stringifyYaml, type YamlValue } from '../../notes/yaml';
import { safeName } from '../hub';
import type { RemoteNote } from '../types';

export const NOTE_FILE = /\.(md|markdown|txt)$/i;

/** Folders never read: app settings, trash, backups and Keeper's own. */
const SKIP_DIR = /^(\.|_resources$|logseq$|node_modules$|\.trash$|\.keeper-notes$|attachments$)/;

export function isNoteFile(rel: string): boolean {
  if (!NOTE_FILE.test(rel)) return false;
  const parts = rel.split('/');
  return !parts.slice(0, -1).some((p) => SKIP_DIR.test(p)) && !parts[parts.length - 1].startsWith('.');
}

export function folderNoteFromFile(rel: string, text: string, mtime: number, size: number): RemoteNote {
  const name = rel.slice(rel.lastIndexOf('/') + 1);
  const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : undefined;
  const title = name.replace(NOTE_FILE, '');
  const version = `${Math.round(mtime)}-${size}`;
  if (/\.txt$/i.test(name)) return { sourceId: rel, title, body: text.replace(/\r\n?/g, '\n'), tags: [], modified: mtime, folder: dir, version };
  const { yaml, body } = splitFrontmatter(text.replace(/^﻿/, ''));
  let props: Record<string, unknown> = {};
  if (yaml) {
    try { const v = parseYaml(yaml); if (v && typeof v === 'object' && !Array.isArray(v)) props = v as Record<string, unknown>; } catch { /* keep it in the body */ }
  }
  const tags = Array.isArray(props.tags) ? props.tags.map(String) : typeof props.tags === 'string' ? props.tags.split(/[,\s]+/).filter(Boolean) : [];
  const { tags: _t, 'keeper-id': _k, ...rest } = props;
  void _t; void _k;
  return { sourceId: rel, title, body: body.replace(/\r\n?/g, '\n').replace(/\n+$/, ''), tags, modified: mtime, folder: dir, version, props: Object.keys(rest).length ? rest : undefined };
}

/** The file text for a note: properties (and tags) on top for .md, plain for .txt. */
export function folderFileText(n: RemoteNote, rel: string): string {
  if (/\.txt$/i.test(rel)) return n.body.endsWith('\n') ? n.body : n.body + '\n';
  const props: Record<string, YamlValue> = { ...((n.props ?? {}) as Record<string, YamlValue>) };
  if (n.tags.length) props.tags = n.tags;
  const fm = Object.keys(props).length ? `---\n${stringifyYaml(props)}---\n` : '';
  return `${fm}${n.body.replace(/\n+$/, '')}\n`;
}

/** Where a new note goes in the folder. */
export function folderRelFor(n: Pick<RemoteNote, 'title' | 'folder'>, ext = 'md'): string {
  const dir = (n.folder ?? '').split('/').map((p) => safeName(p, 60)).filter((p) => p && p !== 'Untitled').join('/');
  return `${dir ? dir + '/' : ''}${safeName(n.title)}.${ext}`;
}
