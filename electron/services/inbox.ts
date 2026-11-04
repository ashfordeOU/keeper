// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The Inbox on disk: one small JSON file in Keeper's data folder (inbox.json),
// read on first use and written after each change (to a temporary file, then
// renamed, so a crash never leaves half a file). Nothing leaves the computer.

import { app } from 'electron';
import { randomUUID } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { addToInbox, cleanInbox, newInboxItem, type InboxInput, type InboxItem } from '../../core/inbox';

let items: InboxItem[] | null = null;
let writing: Promise<void> = Promise.resolve();
const file = () => path.join(app.getPath('userData'), 'inbox.json');

async function load(): Promise<InboxItem[]> {
  if (items) return items;
  try {
    items = cleanInbox(JSON.parse(await fsp.readFile(file(), 'utf8')));
  } catch {
    items = [];
  }
  return items;
}

function save(): Promise<void> {
  const data = JSON.stringify(items ?? [], null, 1);
  writing = writing.then(async () => {
    const tmp = `${file()}.tmp`;
    await fsp.mkdir(path.dirname(tmp), { recursive: true });
    await fsp.writeFile(tmp, data);
    await fsp.rename(tmp, file());
  }).catch(() => undefined);
  return writing;
}

export async function listInbox(): Promise<InboxItem[]> {
  return [...(await load())];
}

export async function addInbox(input: InboxInput): Promise<InboxItem | null> {
  const item = newInboxItem(input, Date.now(), randomUUID());
  if (!item) return null;
  items = addToInbox(await load(), item);
  await save();
  return item;
}

export async function removeInbox(id: string): Promise<void> {
  const list = await load();
  items = list.filter((i) => i.id !== id);
  if (items.length !== list.length) await save();
}

/** Puts a sorted or deleted item back (Undo). */
export async function restoreInbox(item: InboxItem): Promise<void> {
  const [clean] = cleanInbox([item]);
  if (!clean) return;
  items = cleanInbox(addToInbox(await load(), clean));
  await save();
}

export async function inboxCount(): Promise<number> {
  return (await load()).length;
}
