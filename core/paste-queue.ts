// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Paste one by one: copy several things (or pick them in clipboard history),
// then each paste takes the next one, in the order they were copied, until
// none are left. The Island shows how many are left. Pure: the queue only
// holds clipboard history ids; the Island service puts each on the clipboard.

export class PasteQueue {
  /** clip ids still to paste, the next one first */
  items: string[] = [];
  /** copies made now join the queue */
  collecting = false;
  /** how many it held at most (for "2 of 5") */
  total = 0;

  get active(): boolean {
    return this.collecting || this.items.length > 0;
  }

  /** Starts a queue: with ids, ready to paste them; without, collecting what is copied next. */
  start(ids?: string[]) {
    const list = [...new Set((ids ?? []).filter(Boolean))];
    this.items = list;
    this.total = list.length;
    this.collecting = !list.length;
  }

  /** A copy was made: while collecting it joins the end (a copy already waiting is not added twice). */
  copied(id: string): boolean {
    if (!this.collecting || !id || this.items.includes(id)) return false;
    this.items.push(id);
    this.total = Math.max(this.total, this.items.length);
    return true;
  }

  /** The next one to paste (it stays until `took`). */
  peek(): string | undefined {
    return this.items[0];
  }

  /**
   * The first item was pasted: it leaves the queue. Collecting stops at the
   * first paste. Returns the new next one, or undefined when the queue is done.
   */
  took(): string | undefined {
    this.collecting = false;
    this.items.shift();
    return this.items[0];
  }

  /** An item left clipboard history: it leaves the queue too. */
  drop(id: string) {
    this.items = this.items.filter((x) => x !== id);
  }

  stop() {
    this.items = [];
    this.collecting = false;
    this.total = 0;
  }

  /** What the Island shows. */
  view(): { left: number; collecting: boolean; total: number } | undefined {
    return this.active ? { left: this.items.length, collecting: this.collecting, total: this.total } : undefined;
  }
}

/** The Island's words for the queue: "3 left", "Copy to add", "Last one". */
export function queueLabel(v: { left: number; collecting: boolean }): string {
  if (v.collecting) return v.left ? `${v.left} to paste · copy more` : 'Copy what you want to paste';
  if (v.left === 1) return 'Last one';
  return `${v.left} left`;
}
