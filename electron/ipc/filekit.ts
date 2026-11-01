// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// IPC for the file kit: saved workflows (run by hand, on watched folders and
// on a schedule) and the outside engines conversions can use.

import { app, ipcMain } from 'electron';
import path from 'node:path';
import type { EngineInfo } from '../../core/api-filekit';
import type { Workflow } from '../../core/filekit/workflow';
import type { Converter } from '../services/convert';
import { findTool, officeCandidates } from '../services/convert-extra';
import { featureOn, onFeature } from '../services/features';
import { whenIdle } from '../services/governor';
import { Workflows } from '../services/workflows';

export const ENGINES: Omit<EngineInfo, 'found' | 'path'>[] = [
  { id: 'qpdf', name: 'qpdf', for: 'Remove restrictions, fast web view, repair, lossless compression', license: 'Apache-2.0', url: 'https://qpdf.sourceforge.io' },
  { id: 'poppler', name: 'poppler (pdftoppm, pdftocairo, pdffonts)', for: 'Drawing pages from the command line, PDF to SVG, font checks', license: 'GPL-2.0', url: 'https://poppler.freedesktop.org' },
  { id: 'gs', name: 'Ghostscript', for: 'Compression, PDF/A, fonts to outlines, EPS', license: 'AGPL-3.0', url: 'https://ghostscript.com/releases/gsdnld.html' },
  { id: 'soffice', name: 'LibreOffice', for: 'Office documents, presentations and spreadsheets to PDF and between formats', license: 'MPL-2.0', url: 'https://www.libreoffice.org/download' },
  { id: 'pandoc', name: 'Pandoc', for: 'EPUB, LaTeX, reStructuredText and other document formats', license: 'GPL-2.0', url: 'https://pandoc.org/installing.html' },
  { id: 'ebook-convert', name: 'Calibre', for: 'MOBI, AZW3, FB2 and other e-book formats', license: 'GPL-3.0', url: 'https://calibre-ebook.com/download' },
  { id: 'dot', name: 'Graphviz', for: 'Diagrams (.dot, .gv)', license: 'EPL-1.0', url: 'https://graphviz.org/download' },
  { id: 'duckdb', name: 'DuckDB', for: 'Parquet files', license: 'MIT', url: 'https://duckdb.org/docs/installation' },
  { id: 'openssl', name: 'OpenSSL', for: 'Reading .p12/.pfx signing certificates', license: 'Apache-2.0', url: 'https://openssl-library.org' },
];

export function registerFileKitIpc(converter: () => Converter) {
  const flows = new Workflows({
    file: path.join(app.getPath('userData'), 'workflows.json'),
    converter,
    waitTurn: () => whenIdle('ocr'),
  });
  // Watched folders and schedules only while the feature is on; nothing runs otherwise.
  onFeature('workflows', (on) => (on ? void flows.arm() : flows.stop()), { now: true });
  app.on('before-quit', () => flows.stop());

  const need = () => { if (!featureOn('workflows')) throw new Error('Workflows are switched off (Settings → Features)'); };
  ipcMain.handle('filekit.workflows', () => flows.all());
  ipcMain.handle('filekit.saveWorkflow', (_e, w: Workflow) => { need(); return flows.save(w); });
  ipcMain.handle('filekit.deleteWorkflow', (_e, id: string) => flows.remove(id));
  ipcMain.handle('filekit.runWorkflow', (_e, id: string, inputs?: string[]) => { need(); return flows.run(id, inputs); });
  ipcMain.handle('filekit.engines', async (): Promise<EngineInfo[]> => Promise.all(ENGINES.map(async (e) => {
    const names = e.id === 'soffice' ? officeCandidates() : e.id === 'gs' ? (process.platform === 'win32' ? ['gswin64c', 'gswin32c'] : ['gs']) : e.id === 'poppler' ? ['pdftoppm'] : [e.id];
    const p = await findTool(names);
    return { ...e, found: !!p, path: p ?? undefined };
  })));
}
