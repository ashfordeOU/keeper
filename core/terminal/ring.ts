// SPDX-License-Identifier: AGPL-3.0-or-later
// A terminal's memory: the most recent output, kept within a line and byte
// budget so a chatty program can never make Keeper grow without end.

export class RingBuffer {
  private chunks: string[] = [];
  private bytes = 0;
  private lines = 0;

  constructor(
    public maxLines = 10_000,
    /** a hard cap regardless of lines, for programs that never print a newline */
    public maxBytes = 8 * 1024 * 1024,
  ) {}

  push(data: string) {
    if (!data) return;
    this.chunks.push(data);
    this.bytes += data.length;
    this.lines += countLines(data);
    this.trim();
  }

  private trim() {
    while (this.chunks.length > 1 && (this.lines > this.maxLines || this.bytes > this.maxBytes)) {
      const first = this.chunks[0];
      const over = this.lines - this.maxLines;
      if (over > 0 && this.bytes <= this.maxBytes) {
        // Drop whole lines from the front of the oldest chunk when that is enough.
        let cut = 0;
        let dropped = 0;
        while (dropped < over) {
          const i = first.indexOf('\n', cut);
          if (i < 0) break;
          cut = i + 1;
          dropped++;
        }
        if (cut > 0 && cut < first.length) {
          this.chunks[0] = first.slice(cut);
          this.bytes -= cut;
          this.lines -= dropped;
          continue;
        }
      }
      this.chunks.shift();
      this.bytes -= first.length;
      this.lines -= countLines(first);
    }
    // A single huge chunk: keep its tail.
    if (this.chunks.length === 1 && this.bytes > this.maxBytes) {
      this.chunks[0] = this.chunks[0].slice(-this.maxBytes);
      this.bytes = this.chunks[0].length;
      this.lines = countLines(this.chunks[0]);
    }
    // Merge small chunks now and then so the array stays short.
    if (this.chunks.length > 512) this.chunks = [this.chunks.join('')];
  }

  /** Everything kept, oldest first. */
  snapshot(): string {
    if (this.chunks.length > 1) this.chunks = [this.chunks.join('')];
    return this.chunks[0] ?? '';
  }

  get size() {
    return { bytes: this.bytes, lines: this.lines };
  }

  clear() {
    this.chunks = [];
    this.bytes = 0;
    this.lines = 0;
  }
}

function countLines(s: string): number {
  let n = 0;
  for (let i = s.indexOf('\n'); i >= 0; i = s.indexOf('\n', i + 1)) n++;
  return n;
}

/** Removes escape sequences, leaving the text a person would read. */
export function stripAnsi(s: string): string {
  return s
    // OSC ... BEL or ST
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    // CSI
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    // other two-byte escapes
    .replace(/\x1b[@-Z\\-_]/g, '')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
}
