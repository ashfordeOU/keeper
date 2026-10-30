// SPDX-License-Identifier: AGPL-3.0-or-later
// Chooses the viewer for a file from its extension, falling back to its
// first bytes when the extension is unknown or lies.

import type { Magic } from './magic';

export type PreviewKind =
  | 'image' | 'svg' | 'heic' | 'raw' | 'psd' | 'tiff' | 'icns'
  | 'video' | 'audio'
  | 'pdf' | 'docx' | 'sheet' | 'pptx' | 'odt' | 'rtf' | 'iwork' | 'legacy-office'
  | 'markdown' | 'json' | 'html' | 'xml' | 'notebook' | 'log' | 'code' | 'text' | 'subtitle'
  | 'archive' | 'tar' | 'archive-tool' | 'epub'
  | 'font' | 'model' | 'eml' | 'vcf' | 'ics' | 'sqlite' | 'app' | 'folder' | 'binary';

const BROWSER_IMAGES = new Set(['jpg', 'jpeg', 'jpe', 'jfif', 'png', 'apng', 'gif', 'webp', 'avif', 'bmp', 'ico', 'cur']);
const RAW = new Set(['raw', 'cr2', 'cr3', 'crw', 'nef', 'nrw', 'arw', 'srf', 'sr2', 'dng', 'orf', 'rw2', 'raf', 'pef', 'srw', 'x3f', '3fr', 'erf', 'kdc', 'mrw', 'mos', 'iiq', 'rwl']);
/** Containers Chromium plays natively; others are converted on the fly. */
export const PLAYABLE_VIDEO = new Set(['mp4', 'm4v', 'webm', 'mov', 'ogv', 'mkv']);
export const PLAYABLE_AUDIO = new Set(['mp3', 'm4a', 'aac', 'wav', 'ogg', 'oga', 'opus', 'flac', 'weba', 'webm']);
const VIDEO = new Set([...PLAYABLE_VIDEO, 'avi', 'wmv', 'flv', 'mpg', 'mpeg', 'm2v', '3gp', '3g2', 'mts', 'm2ts', 'ts', 'vob', 'divx', 'asf', 'rm', 'rmvb', 'f4v', 'mxf', 'dv']);
const AUDIO = new Set([...PLAYABLE_AUDIO, 'aiff', 'aif', 'aifc', 'wma', 'alac', 'amr', 'ape', 'wv', 'mka', 'mid', 'midi', 'ac3', 'dts', 'caf', 'au', 'snd', 'ra', 'spx', 'tta']);
const SHEET = new Set(['xlsx', 'xlsm', 'xlsb', 'xls', 'ods', 'csv', 'tsv', 'numbers-csv']);
const CODE = new Set([
  'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'mts', 'cts', 'py', 'pyw', 'rb', 'go', 'rs', 'java', 'kt', 'kts', 'scala', 'swift', 'm', 'mm', 'c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'hh',
  'cs', 'fs', 'vb', 'php', 'pl', 'pm', 'lua', 'r', 'jl', 'dart', 'ex', 'exs', 'erl', 'hs', 'clj', 'cljs', 'elm', 'ml', 'nim', 'zig', 'v', 'sol', 'groovy', 'gradle',
  'sh', 'bash', 'zsh', 'fish', 'ps1', 'psm1', 'bat', 'cmd', 'css', 'scss', 'sass', 'less', 'styl', 'vue', 'svelte', 'astro', 'sql', 'graphql', 'gql', 'proto',
  'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf', 'env', 'properties', 'tf', 'hcl', 'nix', 'dockerfile', 'makefile', 'cmake', 'mk', 'diff', 'patch', 'tex', 'bib',
  'asm', 's', 'wasm-text', 'wat', 'glsl', 'hlsl', 'vert', 'frag', 'gd', 'cr', 'rkt', 'lisp', 'scm', 'f90', 'f', 'pas', 'ada', 'cob', 'reg', 'plist', 'gitignore',
  'editorconfig', 'lock', 'xaml', 'csproj', 'sln', 'vbs',
]);
const FONTS = new Set(['ttf', 'otf', 'woff', 'woff2', 'ttc']);
const MODELS = new Set(['glb', 'gltf', 'obj', 'stl', 'ply', 'fbx', '3mf', 'dae']);
const ARCHIVES = new Set(['zip', 'jar', 'war', 'apk', 'aab', 'ipa', 'xpi', 'crx', 'whl', 'nupkg', 'vsix', 'cbz', 'sketch', 'xd', 'kmz', 'appx', 'msix']);
const TAR = new Set(['tar', 'tgz', 'tar.gz', 'gz', 'tbz2', 'tar.bz2', 'txz', 'tar.xz', 'tar.zst']);
const TOOL_ARCHIVES = new Set(['7z', 'rar', 'cab', 'iso', 'dmg', 'cbr', 'bz2', 'xz', 'zst', 'lz', 'lzma', 'arj', 'lzh', 'deb', 'rpm', 'pkg', 'msi', 'exe']);
const TEXT = new Set(['txt', 'text', 'nfo', 'readme', 'me', 'license', 'authors', 'changelog', 'todo', 'rst', 'adoc', 'asciidoc', 'org', 'wiki', 'tsv-text']);
const LOG = new Set(['log', 'out', 'err', 'trace']);
const SUBTITLE = new Set(['srt', 'vtt', 'ass', 'ssa', 'sub', 'lrc']);

export function previewKindOf(name: string, ext: string, isDir: boolean, magic?: Magic): PreviewKind {
  if (isDir) return ext === 'app' ? 'app' : ext === 'pages' || ext === 'key' || ext === 'numbers' ? 'iwork' : 'folder';
  const e = ext.toLowerCase();
  const lower = name.toLowerCase();
  if (e === 'svg' || e === 'svgz') return 'svg';
  if (e === 'heic' || e === 'heif' || e === 'hif') return 'heic';
  if (RAW.has(e)) return 'raw';
  if (e === 'psd' || e === 'psb') return 'psd';
  if (e === 'tif' || e === 'tiff') return 'tiff';
  if (e === 'icns') return 'icns';
  if (e === 'jxl' || e === 'jp2' || e === 'j2k' || e === 'tga' || e === 'exr' || e === 'hdr' || e === 'dds' || e === 'qoi' || e === 'pcx' || e === 'xcf') return 'heic';
  if (BROWSER_IMAGES.has(e)) return 'image';
  if (VIDEO.has(e)) return 'video';
  if (AUDIO.has(e)) return 'audio';
  if (e === 'pdf' || e === 'ai') return 'pdf';
  if (e === 'docx' || e === 'docm' || e === 'dotx') return 'docx';
  if (SHEET.has(e)) return 'sheet';
  if (e === 'pptx' || e === 'pptm' || e === 'ppsx' || e === 'potx') return 'pptx';
  if (e === 'odt' || e === 'odp' || e === 'ott') return 'odt';
  if (e === 'rtf') return 'rtf';
  if (e === 'pages' || e === 'key' || e === 'numbers') return 'iwork';
  if (e === 'doc' || e === 'ppt' || e === 'xlt' || e === 'pps' || e === 'msg') return 'legacy-office';
  if (e === 'epub') return 'epub';
  if (e === 'md' || e === 'markdown' || e === 'mdx' || e === 'mdown' || e === 'mkd') return 'markdown';
  if (e === 'json' || e === 'jsonc' || e === 'json5' || e === 'geojson' || e === 'webmanifest' || e === 'har') return 'json';
  if (e === 'ipynb') return 'notebook';
  if (e === 'html' || e === 'htm' || e === 'xhtml' || e === 'mht') return 'html';
  if (e === 'xml' || e === 'xsd' || e === 'xsl' || e === 'rss' || e === 'atom' || e === 'kml' || e === 'gpx' || e === 'opml') return 'xml';
  if (LOG.has(e)) return 'log';
  if (SUBTITLE.has(e)) return 'subtitle';
  if (CODE.has(e) || /^(dockerfile|makefile|gemfile|rakefile|procfile|vagrantfile|justfile|\.\w+rc)$/.test(lower)) return 'code';
  if (TEXT.has(e)) return 'text';
  if (FONTS.has(e)) return 'font';
  if (MODELS.has(e)) return 'model';
  if (e === 'eml' || e === 'emlx' || e === 'mbox') return 'eml';
  if (e === 'vcf' || e === 'vcard') return 'vcf';
  if (e === 'ics' || e === 'ical' || e === 'ifb') return 'ics';
  if (e === 'sqlite' || e === 'sqlite3' || e === 'db' || e === 'db3') return magic?.id === 'sqlite' || !magic ? 'sqlite' : 'binary';
  if (e === 'appimage' || e === 'app') return 'app';
  if (TAR.has(e) || /\.tar\.(gz|bz2|xz|zst)$/.test(lower)) return e === 'gz' && !/\.tar\.gz$/.test(lower) && magic?.id === 'gzip' ? 'tar' : 'tar';
  if (ARCHIVES.has(e)) return 'archive';
  if (TOOL_ARCHIVES.has(e)) return e === 'exe' || e === 'msi' || e === 'deb' || e === 'rpm' || e === 'pkg' || e === 'dmg' ? 'app' : 'archive-tool';
  return fromMagic(magic);
}

function fromMagic(m?: Magic): PreviewKind {
  switch (m?.id) {
    case undefined: return 'binary';
    case 'png': case 'jpeg': case 'gif': case 'webp': case 'bmp': case 'ico': case 'avif': return 'image';
    case 'heic': case 'jxl': return 'heic';
    case 'tiff': return 'tiff';
    case 'psd': return 'psd';
    case 'icns': return 'icns';
    case 'raw': case 'raf': case 'cr3': return 'raw';
    case 'svg': return 'svg';
    case 'pdf': return 'pdf';
    case 'zip': return 'archive';
    case 'gzip': case 'tar': return 'tar';
    case '7z': case 'rar': case 'bzip2': case 'xz': case 'zstd': return 'archive-tool';
    case 'mp3': case 'flac': case 'ogg': case 'wav': case 'aiff': case 'm4a': return 'audio';
    case 'mp4': case 'mov': case 'mkv': case 'avi': case 'flv': case 'asf': case 'mpeg': return 'video';
    case 'ttf': case 'otf': case 'woff': case 'woff2': return 'font';
    case 'glb': case 'stl': return 'model';
    case 'sqlite': return 'sqlite';
    case 'html': return 'html';
    case 'xml': case 'bplist': return m.id === 'xml' ? 'xml' : 'binary';
    case 'ipynb': return 'notebook';
    case 'eml': return 'eml';
    case 'vcf': return 'vcf';
    case 'ics': return 'ics';
    case 'text': return 'text';
    case 'exe': case 'elf': case 'macho': case 'deb': case 'rpm': case 'dmg': return 'app';
    case 'ole': return 'legacy-office';
    default: return 'binary';
  }
}

/** highlight.js language name for a file, when it is code. */
export function codeLanguage(name: string, ext: string): string | undefined {
  const e = ext.toLowerCase();
  const map: Record<string, string> = {
    js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
    py: 'python', pyw: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', kts: 'kotlin', scala: 'scala', swift: 'swift', m: 'objectivec', mm: 'objectivec',
    c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp', cs: 'csharp', fs: 'fsharp', vb: 'vbnet', php: 'php', pl: 'perl', pm: 'perl', lua: 'lua',
    r: 'r', jl: 'julia', dart: 'dart', ex: 'elixir', exs: 'elixir', erl: 'erlang', hs: 'haskell', clj: 'clojure', cljs: 'clojure', elm: 'elm', ml: 'ocaml', nim: 'nim',
    zig: 'zig', sol: 'solidity', groovy: 'groovy', gradle: 'gradle', sh: 'bash', bash: 'bash', zsh: 'bash', fish: 'bash', ps1: 'powershell', psm1: 'powershell',
    bat: 'dos', cmd: 'dos', css: 'css', scss: 'scss', sass: 'scss', less: 'less', styl: 'stylus', vue: 'xml', svelte: 'xml', astro: 'xml', sql: 'sql', graphql: 'graphql', gql: 'graphql',
    proto: 'protobuf', yaml: 'yaml', yml: 'yaml', toml: 'ini', ini: 'ini', cfg: 'ini', conf: 'ini', env: 'bash', properties: 'properties', tf: 'hcl', hcl: 'hcl', nix: 'nix',
    dockerfile: 'dockerfile', makefile: 'makefile', mk: 'makefile', cmake: 'cmake', diff: 'diff', patch: 'diff', tex: 'latex', bib: 'latex', asm: 'x86asm', s: 'x86asm',
    wat: 'wasm', glsl: 'glsl', vert: 'glsl', frag: 'glsl', hlsl: 'glsl', gd: 'gdscript', lisp: 'lisp', scm: 'scheme', rkt: 'scheme', f90: 'fortran', f: 'fortran', pas: 'delphi',
    ada: 'ada', cob: 'cobol', reg: 'ini', plist: 'xml', xml: 'xml', html: 'xml', htm: 'xml', xaml: 'xml', csproj: 'xml', json: 'json', vbs: 'vbscript', cr: 'crystal',
  };
  if (map[e]) return map[e];
  const n = name.toLowerCase();
  if (n === 'dockerfile') return 'dockerfile';
  if (n === 'makefile' || n === 'justfile') return 'makefile';
  if (/^\.\w+rc$/.test(n)) return 'bash';
  return undefined;
}
