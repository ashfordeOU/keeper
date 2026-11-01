#!/usr/bin/env node
// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Writes build/license_en.txt, a plain-text copy of LICENSE.md for the Windows
// installer's licence page (NSIS shows Markdown as raw text). The output is
// committed too, so packaging works without running this first.
import { readFileSync, writeFileSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const md = readFileSync(new URL('LICENSE.md', root), 'utf8');

const text = md
  .replace(/\r\n/g, '\n')
  .split('\n')
  .map((line) => line
    .replace(/^#{1,6}\s+/, '')                       // headings
    .replace(/^---+\s*$/, '')                        // rules
    .replace(/^(\s*)[*-]\s+/, '$1- ')                // list markers
    .replace(/!?\[([^\]]*)\]\(([^)]+)\)/g, (_, label, url) => (url.startsWith('#') || label === url ? label : `${label} (${url})`))
    .replace(/<(https?:\/\/[^>]+)>/g, '$1')          // autolinks
    .replace(/(\*\*|__)(.+?)\1/g, '$2')              // bold
    .replace(/(^|[^\w*])[*_]([^*_\n]+)[*_](?=[^\w*]|$)/g, '$1$2') // italics
    .replace(/`([^`]+)`/g, '$1')                     // code
    .replace(/\s+$/, ''))
  .join('\n')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

// CRLF and a UTF-8 byte order mark so the installer on Windows shows "Ü" and "®" correctly.
writeFileSync(new URL('build/license_en.txt', root), '\ufeff' + text.replace(/\n/g, '\r\n') + '\r\n');
console.log('build/license_en.txt written from LICENSE.md');
