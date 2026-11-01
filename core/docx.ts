// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Word documents without Word: reading a .docx into HTML (headings, bold,
// italic, underline, lists, tables, line breaks and pictures) for previews,
// PDF and Markdown, and writing a .docx from simple blocks (from text,
// Markdown, HTML or the pages of a PDF).

import { zip } from './zipwrite';
import { zipEntries, zipRead } from './brain/extract';

// ---------------------------------------------------------------- reading

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unxml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

function attr(xml: string, name: string): string | undefined {
  return xml.match(new RegExp(`${name}="([^"]*)"`))?.[1];
}

function runHtml(run: string, images: Map<string, string>): string {
  const props = run.match(/<w:rPr>([\s\S]*?)<\/w:rPr>/)?.[1] ?? '';
  let text = '';
  for (const m of run.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br\/>|<w:drawing>[\s\S]*?<\/w:drawing>/g)) {
    if (m[0].startsWith('<w:tab')) text += '&emsp;';
    else if (m[0].startsWith('<w:br')) text += '<br>';
    else if (m[0].startsWith('<w:drawing')) {
      const id = attr(m[0], 'r:embed');
      const src = id ? images.get(id) : undefined;
      if (src) text += `<img src="${src}" alt="">`;
    } else text += esc(unxml(m[1]));
  }
  if (!text) return '';
  const on = (tag: string) => new RegExp(`<w:${tag}(?:\\s+w:val="(?!0|false)[^"]*")?\\s*/>`).test(props);
  if (on('b')) text = `<strong>${text}</strong>`;
  if (on('i')) text = `<em>${text}</em>`;
  if (/<w:u\s+w:val="(?!none)/.test(props)) text = `<u>${text}</u>`;
  if (on('strike')) text = `<s>${text}</s>`;
  return text;
}

function paragraphHtml(p: string, images: Map<string, string>, links: Map<string, string>): { tag: string; html: string; list?: 'ul' | 'ol' } {
  const style = p.match(/<w:pStyle w:val="([^"]+)"/)?.[1] ?? '';
  let html = '';
  for (const m of p.matchAll(/<w:hyperlink([^>]*)>([\s\S]*?)<\/w:hyperlink>|<w:r[ >][\s\S]*?<\/w:r>/g)) {
    if (m[0].startsWith('<w:hyperlink')) {
      const href = links.get(attr(m[1], 'r:id') ?? '') ?? '';
      const inner = [...m[2].matchAll(/<w:r[ >][\s\S]*?<\/w:r>/g)].map((r) => runHtml(r[0], images)).join('');
      html += href ? `<a href="${esc(href)}">${inner}</a>` : inner;
    } else html += runHtml(m[0], images);
  }
  const h = style.match(/^(?:Heading|heading)\s?(\d)$/)?.[1];
  if (style === 'Title') return { tag: 'h1', html };
  if (h) return { tag: `h${Math.min(6, +h)}`, html };
  if (/<w:numPr>/.test(p)) {
    const ordered = /Number|Decimal/i.test(style);
    return { tag: 'li', html, list: ordered ? 'ol' : 'ul' };
  }
  return { tag: 'p', html };
}

/** HTML for a Word document's body, with pictures inlined as data URLs. */
export function docxToHtml(b: Buffer): string {
  const entries = zipEntries(b);
  const read = (name: string) => {
    const e = entries.find((x) => x.name === name);
    return e ? zipRead(b, e) : undefined;
  };
  const doc = read('word/document.xml')?.toString('utf8');
  if (!doc) throw new Error('This is not a Word document');
  const rels = read('word/_rels/document.xml.rels')?.toString('utf8') ?? '';
  const images = new Map<string, string>();
  const links = new Map<string, string>();
  for (const r of rels.matchAll(/<Relationship\s([^>]+)\/>/g)) {
    const id = attr(r[1], 'Id');
    const target = attr(r[1], 'Target');
    const type = attr(r[1], 'Type') ?? '';
    if (!id || !target) continue;
    if (/\/image$/.test(type)) {
      const data = read(`word/${target.replace(/^\.?\//, '')}`);
      const ext = target.split('.').pop()?.toLowerCase() ?? 'png';
      const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'gif' ? 'image/gif' : ext === 'svg' ? 'image/svg+xml' : 'image/png';
      if (data && data.length < 8 * 1024 * 1024) images.set(id, `data:${mime};base64,${data.toString('base64')}`);
    } else if (/\/hyperlink$/.test(type)) links.set(id, unxml(target));
  }
  const body = doc.match(/<w:body>([\s\S]*)<\/w:body>/)?.[1] ?? '';
  const out: string[] = [];
  let open: 'ul' | 'ol' | undefined;
  const close = () => {
    if (open) out.push(`</${open}>`);
    open = undefined;
  };
  for (const m of body.matchAll(/<w:tbl>[\s\S]*?<\/w:tbl>|<w:p[ >][\s\S]*?<\/w:p>|<w:p\/>/g)) {
    if (m[0].startsWith('<w:tbl')) {
      close();
      const rows = [...m[0].matchAll(/<w:tr[ >][\s\S]*?<\/w:tr>/g)].map((r) =>
        `<tr>${[...r[0].matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)].map((c) => `<td>${[...c[0].matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)].map((p) => paragraphHtml(p[0], images, links).html).join('<br>')}</td>`).join('')}</tr>`);
      out.push(`<table>${rows.join('')}</table>`);
      continue;
    }
    if (m[0] === '<w:p/>') {
      close();
      out.push('<p></p>');
      continue;
    }
    const p = paragraphHtml(m[0], images, links);
    if (p.tag === 'li') {
      if (open !== p.list) {
        close();
        open = p.list;
        out.push(`<${open}>`);
      }
      out.push(`<li>${p.html}</li>`);
    } else {
      close();
      out.push(`<${p.tag}>${p.html}</${p.tag}>`);
    }
  }
  close();
  return out.join('\n');
}

/** A complete page to print or show, with readable defaults. */
export function htmlPage(body: string, title = 'Document'): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
body{font:11pt/1.5 -apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;color:#111;max-width:760px;margin:0 auto;padding:24px}
h1{font-size:22pt;margin:.6em 0 .3em}h2{font-size:17pt;margin:.8em 0 .3em}h3{font-size:14pt}
img{max-width:100%;height:auto}table{border-collapse:collapse;margin:.6em 0}td,th{border:1px solid #bbb;padding:4px 8px;vertical-align:top}
pre,code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:10pt}pre{background:#f4f4f4;padding:10px;border-radius:6px;white-space:pre-wrap}
blockquote{border-left:3px solid #ccc;margin:0;padding-left:12px;color:#444}a{color:#0b5ad8}
@page{margin:18mm}
</style></head><body>${body}</body></html>`;
}

// ---------------------------------------------------------------- writing

export type Block =
  | { type: 'heading'; level: number; text: string }
  | { type: 'para'; runs: { text: string; bold?: boolean; italic?: boolean; code?: boolean }[] }
  | { type: 'bullet'; text: string; ordered?: boolean }
  | { type: 'code'; text: string }
  | { type: 'image'; png: Uint8Array; width: number; height: number }
  | { type: 'pageBreak' };

const x = (s: string) => esc(s).replace(/"/g, '&quot;');

function runsXml(runs: { text: string; bold?: boolean; italic?: boolean; code?: boolean }[]): string {
  return runs.map((r) => {
    const props = `${r.bold ? '<w:b/>' : ''}${r.italic ? '<w:i/>' : ''}${r.code ? '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>' : ''}`;
    const lines = r.text.split('\n');
    return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}${lines.map((l, i) => `${i ? '<w:br/>' : ''}<w:t xml:space="preserve">${x(l)}</w:t>`).join('')}</w:r>`;
  }).join('');
}

/** A .docx with the given blocks (Word, Pages, LibreOffice and Google Docs open it). */
export function buildDocx(blocks: Block[], title = 'Document'): Buffer {
  const media: { name: string; data: Uint8Array }[] = [];
  const rels: string[] = ['<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>', '<Relationship Id="rIdNum" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>'];
  const body = blocks.map((b, idx) => {
    switch (b.type) {
      case 'heading': return `<w:p><w:pPr><w:pStyle w:val="Heading${Math.min(6, Math.max(1, b.level))}"/></w:pPr>${runsXml([{ text: b.text }])}</w:p>`;
      case 'para': return `<w:p>${runsXml(b.runs)}</w:p>`;
      case 'bullet': return `<w:p><w:pPr><w:pStyle w:val="${b.ordered ? 'ListNumber' : 'ListBullet'}"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="${b.ordered ? 2 : 1}"/></w:numPr></w:pPr>${runsXml([{ text: b.text }])}</w:p>`;
      case 'code': return `<w:p><w:pPr><w:pStyle w:val="Code"/></w:pPr>${runsXml([{ text: b.text, code: true }])}</w:p>`;
      case 'pageBreak': return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
      case 'image': {
        const id = `rIdImg${idx}`;
        const name = `image${idx}.png`;
        media.push({ name, data: b.png });
        rels.push(`<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${name}"/>`);
        // Fit the page width (6.5 in) keeping the shape; EMU = 914400 per inch.
        const maxW = 6.5 * 914400;
        const cx = Math.min(maxW, Math.round(b.width * 9525));
        const cy = Math.round((cx / Math.max(1, b.width)) * b.height);
        return `<w:p><w:r><w:drawing><wp:inline><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${idx + 1}" name="${name}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="${idx + 1}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
      }
    }
  }).join('');
  const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"';
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="567" w:footer="567" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const heading = (n: number, size: number) => `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="${n - 1}"/></w:pPr><w:rPr><w:b/><w:sz w:val="${size}"/></w:rPr></w:style>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>${heading(1, 36)}${heading(2, 30)}${heading(3, 26)}${heading(4, 24)}${heading(5, 22)}${heading(6, 22)}<w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/><w:basedOn w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="ListNumber"><w:name w:val="List Number"/><w:basedOn w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="20"/></w:rPr></w:style></w:styles>`;
  const numbering = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`;
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const files: { name: string; data: Uint8Array }[] = [
    { name: '[Content_Types].xml', data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`) },
    { name: '_rels/.rels', data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`) },
    { name: 'docProps/core.xml', data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${x(title)}</dc:title><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created></cp:coreProperties>`) },
    { name: 'word/document.xml', data: Buffer.from(document) },
    { name: 'word/styles.xml', data: Buffer.from(styles) },
    { name: 'word/numbering.xml', data: Buffer.from(numbering) },
    { name: 'word/_rels/document.xml.rels', data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.join('')}</Relationships>`) },
    ...media.map((m) => ({ name: `word/media/${m.name}`, data: m.data })),
  ];
  return zip(files);
}

// ---------------------------------------------------------------- from text, Markdown and HTML

function inlineRuns(s: string): { text: string; bold?: boolean; italic?: boolean; code?: boolean }[] {
  const out: { text: string; bold?: boolean; italic?: boolean; code?: boolean }[] = [];
  const re = /(\*\*|__)(.+?)\1|(\*|_)(.+?)\3|`([^`]+)`|\[([^\]]+)\]\([^)]+\)/g;
  let last = 0;
  for (const m of s.matchAll(re)) {
    if (m.index! > last) out.push({ text: s.slice(last, m.index) });
    if (m[2]) out.push({ text: m[2], bold: true });
    else if (m[4]) out.push({ text: m[4], italic: true });
    else if (m[5]) out.push({ text: m[5], code: true });
    else if (m[6]) out.push({ text: m[6] });
    last = m.index! + m[0].length;
  }
  if (last < s.length) out.push({ text: s.slice(last) });
  return out.length ? out : [{ text: '' }];
}

/** Markdown (or plain text, which is Markdown without marks) as blocks. */
export function markdownBlocks(md: string): Block[] {
  const blocks: Block[] = [];
  const lines = md.replace(/\r/g, '').split('\n');
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ type: 'para', runs: inlineRuns(para.join(' ')) });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^```/.test(l)) {
      flush();
      const code: string[] = [];
      for (i++; i < lines.length && !/^```/.test(lines[i]); i++) code.push(lines[i]);
      blocks.push({ type: 'code', text: code.join('\n') });
      continue;
    }
    const h = l.match(/^(#{1,6})\s+(.*)$/);
    const b = l.match(/^\s*[-*+]\s+(.*)$/);
    const n = l.match(/^\s*\d+[.)]\s+(.*)$/);
    if (h) {
      flush();
      blocks.push({ type: 'heading', level: h[1].length, text: h[2].replace(/[*_`]/g, '') });
    } else if (b || n) {
      flush();
      blocks.push({ type: 'bullet', text: (b?.[1] ?? n![1]).replace(/\*\*|__|`/g, ''), ordered: !!n });
    } else if (/^\s*(---|\*\*\*)\s*$/.test(l)) {
      flush();
      blocks.push({ type: 'pageBreak' });
    } else if (!l.trim()) flush();
    else para.push(l.trim());
  }
  flush();
  return blocks;
}

/** Simple HTML (pages, e-mails, exported notes) as blocks. */
export function htmlBlocks(html: string): Block[] {
  const md = html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '')
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, n, t) => `\n${'#'.repeat(+n)} ${t.replace(/<[^>]+>/g, '')}\n`)
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m, t) => `\n- ${t.replace(/<[^>]+>/g, '')}`)
    .replace(/<(strong|b)>([\s\S]*?)<\/\1>/gi, '**$2**')
    .replace(/<(em|i)>([\s\S]*?)<\/\1>/gi, '*$2*')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|table|ul|ol|blockquote|pre)>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  return markdownBlocks(md);
}

/** Plain text of a Word document's HTML, for .txt and as Markdown. */
export function htmlToMarkdown(html: string): string {
  return html
    .replace(/<h([1-6])>([\s\S]*?)<\/h\1>/g, (_m, n, t) => `${'#'.repeat(+n)} ${t.replace(/<[^>]+>/g, '')}\n\n`)
    .replace(/<li>([\s\S]*?)<\/li>/g, '- $1\n')
    .replace(/<\/?(ul|ol)>/g, '\n')
    .replace(/<strong>([\s\S]*?)<\/strong>/g, '**$1**')
    .replace(/<em>([\s\S]*?)<\/em>/g, '*$1*')
    .replace(/<a href="([^"]*)">([\s\S]*?)<\/a>/g, '[$2]($1)')
    .replace(/<img[^>]*>/g, '')
    .replace(/<br>/g, '\n')
    .replace(/<\/p>/g, '\n\n')
    .replace(/<\/td>/g, ' | ')
    .replace(/<\/tr>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&emsp;/g, '\t').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim() + '\n';
}
