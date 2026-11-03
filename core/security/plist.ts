// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// A small reader for XML property lists (launchd's login items), enough for
// the Fix-it List's details: dict, array, string, integer, real, true, false,
// date and data. Binary plists are converted to XML first (plutil on macOS).

export type PlistValue = string | number | boolean | PlistValue[] | { [k: string]: PlistValue };

const ENT: Record<string, string> = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&apos;': "'" };
const unescape = (s: string) => s.replace(/&(lt|gt|amp|quot|apos);|&#(\d+);|&#x([0-9a-f]+);/gi, (m, _n, d, h) => (d ? String.fromCharCode(Number(d)) : h ? String.fromCharCode(parseInt(h, 16)) : ENT[m] ?? m));

/** The top-level value of an XML plist, or undefined when it cannot be read. */
export function parsePlist(xml: string): PlistValue | undefined {
  const tokens = [...xml.replace(/<\?xml[^>]*>|<!DOCTYPE[^>]*>|<!--[\s\S]*?-->/g, '').matchAll(/<(\/?)(\w+)(\s*\/)?>([^<]*)/g)];
  let i = 0;
  const value = (): PlistValue | undefined => {
    while (i < tokens.length) {
      const [, close, tag, selfClose, text] = tokens[i++];
      if (close) return undefined;
      switch (tag) {
        case 'plist': continue;
        case 'true': if (!selfClose) i++; return true;
        case 'false': if (!selfClose) i++; return false;
        case 'string': case 'date': case 'data': {
          if (selfClose) return '';
          i++; // the closing tag
          return tag === 'data' ? text.replace(/\s+/g, '') : unescape(text);
        }
        case 'integer': case 'real': i++; return Number(text.trim());
        case 'array': {
          if (selfClose) return [];
          const out: PlistValue[] = [];
          for (;;) {
            const v = value();
            if (v === undefined) return out;
            out.push(v);
          }
        }
        case 'dict': {
          if (selfClose) return {};
          const out: Record<string, PlistValue> = {};
          for (;;) {
            const t = tokens[i];
            if (!t || t[1]) { i++; return out; }
            if (t[2] !== 'key') { i++; continue; }
            i += 2; // <key>text and </key>
            const v = value();
            if (v === undefined) return out;
            out[unescape(t[4])] = v;
          }
        }
        default: return undefined;
      }
    }
    return undefined;
  };
  try {
    return value();
  } catch {
    return undefined;
  }
}

export interface LaunchdJob {
  label?: string;
  program?: string;
  args: string[];
  runAtLoad?: boolean;
  /** true, false, or a description of the conditions */
  keepAlive?: boolean | string;
  workingDirectory?: string;
  startInterval?: number;
}

/** What a launchd plist runs and when. */
export function launchdJob(v: PlistValue | undefined): LaunchdJob | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const str = (x: PlistValue | undefined) => (typeof x === 'string' ? x : undefined);
  const args = Array.isArray(v.ProgramArguments) ? v.ProgramArguments.filter((a): a is string => typeof a === 'string') : [];
  const ka = v.KeepAlive;
  return {
    label: str(v.Label),
    program: str(v.Program) ?? args[0],
    args: str(v.Program) ? args.slice(1) : args.slice(1),
    runAtLoad: typeof v.RunAtLoad === 'boolean' ? v.RunAtLoad : undefined,
    keepAlive: typeof ka === 'boolean' ? ka : ka && typeof ka === 'object' && !Array.isArray(ka) ? `when ${Object.keys(ka).join(', ')}` : undefined,
    workingDirectory: str(v.WorkingDirectory),
    startInterval: typeof v.StartInterval === 'number' ? v.StartInterval : undefined,
  };
}
