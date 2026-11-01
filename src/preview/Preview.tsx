// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The universal previewer. Works out what a file is, then hands it to the
// right viewer; heavy viewers (PDF, 3D, spreadsheets, code) load on demand.

import { Component, lazy, Suspense, useEffect, useState, type ComponentType, type ReactNode } from 'react';
import type { PreviewKind } from '../../core/previewKind';
import type { PreviewInfo } from '../../core/previewTypes';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { PreviewUnavailable } from './util';
import './preview.css';

export type PreviewMode = 'inline' | 'full';

export interface ViewerProps {
  info: PreviewInfo;
  mode: PreviewMode;
  /** open another file in the viewer stack (a file inside an archive, an attachment) */
  openNested?: (path: string) => void;
}

const images = () => import('./viewers/images');
const media = () => import('./viewers/media');
const docs = () => import('./viewers/docs');
const text = () => import('./viewers/text');
const other = () => import('./viewers/other');
const cad = () => import('./viewers/cad');
const pick = <K extends string>(loader: () => Promise<Record<K, ComponentType<ViewerProps>>>, name: K) => lazy(() => loader().then((m) => ({ default: m[name] })));

const VIEWERS: Record<PreviewKind, ComponentType<ViewerProps>> = {
  image: pick(images, 'ImageViewer'),
  svg: pick(images, 'SvgViewer'),
  heic: pick(images, 'DecodedViewer'),
  raw: pick(images, 'DecodedViewer'),
  icns: pick(images, 'DecodedViewer'),
  psd: pick(images, 'PsdViewer'),
  tiff: pick(images, 'TiffViewer'),
  video: pick(media, 'VideoViewer'),
  audio: pick(media, 'AudioViewer'),
  pdf: pick(docs, 'PdfViewer'),
  docx: pick(docs, 'DocxViewer'),
  sheet: pick(docs, 'SheetViewer'),
  pptx: pick(docs, 'PptxViewer'),
  odt: pick(docs, 'OdfViewer'),
  rtf: pick(docs, 'RtfViewer'),
  iwork: pick(docs, 'IWorkViewer'),
  'legacy-office': pick(docs, 'LegacyOfficeViewer'),
  markdown: pick(text, 'MarkdownViewer'),
  json: pick(text, 'JsonViewer'),
  html: pick(text, 'HtmlViewer'),
  xml: pick(text, 'CodeViewer'),
  notebook: pick(text, 'NotebookViewer'),
  log: pick(text, 'LogViewer'),
  code: pick(text, 'CodeViewer'),
  text: pick(text, 'CodeViewer'),
  subtitle: pick(text, 'SubtitleViewer'),
  archive: pick(other, 'ArchiveViewer'),
  tar: pick(other, 'ArchiveViewer'),
  'archive-tool': pick(other, 'ArchiveViewer'),
  epub: pick(other, 'EpubViewer'),
  font: pick(other, 'FontViewer'),
  model: pick(other, 'ModelViewer'),
  cad: pick(cad, 'CadViewer'),
  eml: pick(other, 'MailViewer'),
  vcf: pick(other, 'ContactViewer'),
  ics: pick(other, 'CalendarViewer'),
  sqlite: pick(other, 'SqliteViewer'),
  app: pick(other, 'AppViewer'),
  folder: pick(other, 'FolderViewer'),
  binary: pick(other, 'HexViewer'),
};

const infoCache = new Map<string, Promise<PreviewInfo>>();

export function usePreviewInfo(path: string | null): { info: PreviewInfo | null; error: string | null } {
  const [state, setState] = useState<{ info: PreviewInfo | null; error: string | null }>({ info: null, error: null });
  useEffect(() => {
    if (!path) return;
    let alive = true;
    setState({ info: null, error: null });
    let p = infoCache.get(path);
    if (!p) {
      p = api.preview.info(path);
      infoCache.set(path, p);
      // Forget it soon so edits to the file show up.
      setTimeout(() => infoCache.delete(path), 15_000);
    }
    p.then((info) => alive && setState({ info, error: null })).catch((e: unknown) => {
      infoCache.delete(path);
      if (alive) setState({ info: null, error: e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e) });
    });
    return () => { alive = false; };
  }, [path]);
  return state;
}

export function FilePreview({ path, mode = 'inline', openNested }: { path: string; mode?: PreviewMode; openNested?: (p: string) => void }) {
  const { info, error } = usePreviewInfo(path);
  if (error) return <PreviewMessage icon="warning" title="Cannot preview this file">{error}</PreviewMessage>;
  if (!info) return <PreviewLoading />;
  const V = VIEWERS[info.kind] ?? VIEWERS.binary;
  return (
    <div className={`pv pv-${mode} pv-kind-${info.kind}`} data-kind={info.kind}>
      <ViewerBoundary key={info.path}>
        <Suspense fallback={<PreviewLoading />}>
          <V info={info} mode={mode} openNested={openNested} />
        </Suspense>
      </ViewerBoundary>
    </div>
  );
}

export function PreviewLoading({ label = 'Opening…' }: { label?: string }) {
  return (
    <div className="pv-center">
      <div className="spinner" />
      <div className="small muted">{label}</div>
    </div>
  );
}

export function PreviewMessage({ icon = 'info', title, children }: { icon?: string; title: string; children?: ReactNode }) {
  return (
    <div className="pv-center pv-message">
      <Icon name={icon} size={30} stroke={1.4} />
      <div className="pv-message-title">{title}</div>
      {children ? <div className="small muted">{children}</div> : null}
    </div>
  );
}


class ViewerBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    const e = this.state.error;
    if (!e) return this.props.children;
    if (e instanceof PreviewUnavailable) return <PreviewMessage icon="eye" title="Preview not available">{e.message}</PreviewMessage>;
    return <PreviewMessage icon="warning" title="This file could not be shown">{e.message}</PreviewMessage>;
  }
}

/** Runs an async loader for a viewer and rethrows failures into the boundary. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | undefined; error: Error | null; loading: boolean } {
  const [s, setS] = useState<{ data: T | undefined; error: Error | null; loading: boolean }>({ data: undefined, error: null, loading: true });
  useEffect(() => {
    let alive = true;
    setS({ data: undefined, error: null, loading: true });
    fn().then((data) => alive && setS({ data, error: null, loading: false })).catch((error: unknown) => alive && setS({ data: undefined, error: error instanceof Error ? error : new Error(String(error)), loading: false }));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return s;
}

/** Shows loading, or an error message, or the content. */
export function Loaded<T>({ state, children, label }: { state: { data: T | undefined; error: Error | null; loading: boolean }; children: (d: T) => ReactNode; label?: string }) {
  if (state.error) {
    if (state.error instanceof PreviewUnavailable) return <PreviewMessage icon="eye" title="Preview not available">{state.error.message}</PreviewMessage>;
    return <PreviewMessage icon="warning" title="This file could not be shown">{state.error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}</PreviewMessage>;
  }
  if (state.loading || state.data === undefined) return <PreviewLoading label={label} />;
  return <>{children(state.data)}</>;
}

/** A row of small controls above a viewer. */
export function Bar({ children }: { children: ReactNode }) {
  return <div className="pv-bar">{children}</div>;
}

export function BarButton({ icon, label, onClick, on, disabled }: { icon?: string; label?: string; onClick: () => void; on?: boolean; disabled?: boolean }) {
  return (
    <button className={`pv-btn ${on ? 'on' : ''}`} onClick={onClick} title={label} disabled={disabled} aria-pressed={on}>
      {icon ? <Icon name={icon} size={14} /> : null}
      {label && !icon ? <span>{label}</span> : null}
    </button>
  );
}
