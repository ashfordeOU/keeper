// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// A link from a task or an event back to the email it came from:
// keeper://mail/<message id>. Stored in the task's or event's url and as the
// last line of its notes (so it survives calendars and task lists that drop
// the url), and opened by Keeper's Mail.

const PREFIX = 'keeper://mail/';

export function mailLink(id: string): string {
  return PREFIX + encodeURIComponent(id);
}

/** The message id in a keeper://mail/… link anywhere in the text, or null. */
export function mailIdIn(text?: string | null): string | null {
  if (!text) return null;
  const m = text.match(/keeper:\/\/mail\/([^\s<>"')]+)/);
  if (!m) return null;
  try {
    const id = decodeURIComponent(m[1]);
    return id.split(':').length > 2 ? id : null;
  } catch {
    return null;
  }
}

/** Notes for a task or event made from a message: who it is from, the subject, and the link back. */
export function notesFromMessage(m: { id: string; subject?: string; from?: { name?: string; address: string } }): string {
  const from = m.from ? (m.from.name ? `${m.from.name} <${m.from.address}>` : m.from.address) : '';
  return [`From an email${from ? ` from ${from}` : ''}: ${m.subject || '(no subject)'}`, mailLink(m.id)].join('\n');
}
