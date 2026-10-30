// SPDX-License-Identifier: AGPL-3.0-or-later
// Space Map: every folder as a rectangle sized by the space it uses.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { formatBytes } from '../../core/format';
import { squarify, topWithRest } from '../../core/treemap';
import { BubbleView } from '../components/BubbleView';
import type { SpaceNode } from '../../core/types';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { ContextMenu, Empty, Loading, PageHead, type MenuItem } from '../components/ui';
import { useAsync, useStore } from '../state';
import '../styles/screens-b.css';

const PLAYFUL = ['#6d6dff', '#f0617a', '#8b5cf6', '#f59e0b', '#3b82f6', '#14b8a6', '#10b981', '#ec4899', '#0ea5e9', '#a16207', '#64748b', '#ef4444'];
const MINIMAL = ['#3f3f46', '#52525b', '#27272a', '#71717a', '#44444c', '#5f5f68'];

export function Space() {
  const { info, settings, trash } = useStore();
  const disks = useAsync(() => api.system.disks(), []);
  const [path, setPath] = useState<string | null>(null);
  const [root, setRoot] = useState<string | null>(null);
  const [node, setNode] = useState<SpaceNode | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; n: SpaceNode } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 560 });
  const [view, setView] = useState<'map' | 'bubbles'>(() => { try { return localStorage.getItem('space.view') === 'bubbles' ? 'bubbles' : 'map'; } catch { return 'map'; } });
  const pickView = (v: 'map' | 'bubbles') => { setView(v); try { localStorage.setItem('space.view', v); } catch { /* storage unavailable */ } };

  useEffect(() => {
    if (info && path === null) { setPath(info.home); setRoot(info.home); }
  }, [info, path]);

  useEffect(() => {
    if (!path) return;
    let alive = true;
    setLoading(true);
    setError(null);
    api.space.tree(path)
      .then((n) => { if (alive) setNode(n); })
      .catch((e: unknown) => { if (alive) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [path]);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const palette = settings?.look === 'minimal' ? MINIMAL : PLAYFUL;
  const children = node?.children ?? [];
  const items = topWithRest(children, 40, (rest, s) => ({ name: `${rest.length} smaller items`, path: '', size: s, files: rest.reduce((n, r) => n + r.files, 0), kind: 'other' as const }));
  const tiles = squarify(items, { x: 0, y: 0, w: size.w, h: size.h });
  const sep = info?.sep ?? '/';

  // Breadcrumb from the scan root to the current folder.
  const crumbs: { name: string; path: string }[] = [];
  if (root && path) {
    crumbs.push({ name: root === info?.home ? 'Home' : root, path: root });
    const rest = path.startsWith(root) ? path.slice(root.length).split(/[\\/]/).filter(Boolean) : [];
    let acc = root;
    for (const part of rest) {
      acc = acc.endsWith(sep) ? acc + part : acc + sep + part;
      crumbs.push({ name: part, path: acc });
    }
  }

  const open = (n: SpaceNode) => {
    if (!n.path) return;
    if (n.kind === 'folder') setPath(n.path);
    else void api.files.reveal(n.path);
  };

  const menuItems = (n: SpaceNode): MenuItem[] => [
    ...(n.kind === 'folder' ? [{ label: 'Open in Space Map', icon: 'map', run: () => setPath(n.path) }] : [{ label: 'Open', icon: 'external', run: () => void api.files.open(n.path) }]),
    { label: 'Show in Folder', icon: 'reveal', run: () => void api.files.reveal(n.path) },
    { label: 'Copy Path', icon: 'copy', run: () => void api.files.copyText(n.path) },
    { sep: true, label: '' },
    { label: 'Move to Trash', icon: 'trash', danger: true, run: () => void trash([n.path]).then(() => setNode((cur) => cur && { ...cur, size: cur.size - n.size, children: cur.children?.filter((c) => c.path !== n.path) })) },
  ];

  return (
    <div>
      <PageHead title="Space Map" sub="See where your space went. Click a folder to look inside; right-click for more.">
        {(disks.data ?? []).map((d) => (
          <button key={d.mount} className={`btn sm ${root === d.mount ? 'primary' : ''}`} onClick={() => { setRoot(d.mount); setPath(d.mount); }} title={`${formatBytes(d.free)} free of ${formatBytes(d.total)}`}>
            <Icon name="archive" size={13} /> {d.label} <span className="muted">{formatBytes(d.free)} free</span>
          </button>
        ))}
        {info ? <button className={`btn sm ${root === info.home ? 'primary' : ''}`} onClick={() => { setRoot(info.home); setPath(info.home); }}><Icon name="home" size={13} /> Home</button> : null}
      </PageHead>

      <div className="row" style={{ marginBottom: 10 }}>
        <div className="crumbs grow">
          {crumbs.map((c, i) => (
            <span key={c.path} className="row" style={{ gap: 2 }}>
              {i ? <Icon name="chevronRight" size={12} /> : null}
              <button onClick={() => setPath(c.path)}>{c.name}</button>
            </span>
          ))}
        </div>
        <div className="seg">
          <button className={view === 'map' ? 'on' : ''} onClick={() => pickView('map')} title="Rectangles"><Icon name="grid" size={13} /> Map</button>
          <button className={view === 'bubbles' ? 'on' : ''} onClick={() => pickView('bubbles')} title="Bubbles you can throw around"><Icon name="drop" size={13} /> Bubbles</button>
        </div>
        {node ? <span className="muted small">{formatBytes(node.size)} · {node.files.toLocaleString()} files</span> : null}
        {loading ? <div className="spinner" /> : null}
      </div>

      <div className="space-layout">
        <div className="space-map" ref={box}>
          {error ? <Empty icon="warning" title="Could not read this folder">{error}</Empty> : null}
          {!node && loading ? <Loading label="Measuring folders…" /> : null}
          {node && !children.length && !loading ? <Empty icon="folder" title="This folder is empty" /> : null}
          {view === 'bubbles' && node && children.length ? (
            <BubbleView items={items} width={size.w} height={size.h} palette={palette} onOpen={open} onMenu={(e, n) => setMenu({ x: e.clientX, y: e.clientY, n })} />
          ) : null}
          <div className="treemap" style={{ minHeight: 0, height: '100%', display: view === 'bubbles' ? 'none' : undefined }}>
            {tiles.map((t, i) => {
              const small = t.w < 70 || t.h < 40;
              return (
                <div
                  key={t.item.path || `rest-${i}`}
                  className="tile"
                  style={{ left: t.x, top: t.y, width: t.w, height: t.h, background: t.item.path ? palette[i % palette.length] : 'var(--text-3)', opacity: loading ? 0.6 : 1 }}
                  title={`${t.item.name} — ${formatBytes(t.item.size)}`}
                  onClick={() => open(t.item)}
                  onContextMenu={(e) => { e.preventDefault(); if (t.item.path) setMenu({ x: e.clientX, y: e.clientY, n: t.item }); }}
                >
                  {!small ? (
                    <>
                      <div className="n ellipsis">{t.item.kind === 'folder' ? '' : ''}{t.item.name}</div>
                      <div className="s">{formatBytes(t.item.size)}</div>
                      {t.item.cleanable && t.h > 60 ? <span className="badge"><Icon name="broom" size={10} /> Cleanable</span> : null}
                    </>
                  ) : null}
                </div>
              );
            })}
          </div>
        </div>

        <div className="card" style={{ padding: 8, maxHeight: 560, overflow: 'auto' }}>
          <div className="size-list">
            {[...children].sort((a, b) => b.size - a.size).map((c) => (
              <div key={c.path} className="r" onClick={() => open(c)} onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY, n: c }); }}>
                <span className="row ellipsis"><Icon name={c.kind === 'folder' ? 'folder' : 'other'} size={13} /> <span className="ellipsis">{c.name}</span>{c.cleanable ? <Icon name="broom" size={11} style={{ color: 'var(--ok)' }} /> : null}</span>
                <span className="muted num">{formatBytes(c.size)}</span>
                <div className="bar"><i style={{ width: `${(c.size / Math.max(1, node?.size ?? 1)) * 100}%`, background: 'var(--accent)' }} /></div>
              </div>
            ))}
          </div>
        </div>
      </div>
      {menu ? <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.n)} onClose={() => setMenu(null)} /> : null}
    </div>
  );
}
