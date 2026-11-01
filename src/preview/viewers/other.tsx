// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Archives, e-books, fonts, 3D models, e-mail, contacts, calendars, SQLite
// databases, apps, folders, and a hex view for everything else.

import JSZip from 'jszip';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ArchiveEntry } from '../../../core/archive';
import { summarize } from '../../../core/archive';
import { bytesToText, parseMail, parseVcards, type Mail } from '../../../core/docparse';
import { formatBytes, formatDate } from '../../../core/format';
import { parseIcs } from '../../../core/island';
import { hexLines } from '../../../core/magic';
import { api, isDemo } from '../../api';
import { Icon } from '../../components/Icon';
import { openNative } from '../../lib/native';
import { KIND_COLOR } from '../../components/ui';
import { Bar, BarButton, Loaded, PreviewMessage, useLoad, type ViewerProps } from '../Preview';
import { fetchBytes, fileUrl, isDark, onLinkClick, sandboxDoc, sanitize } from '../util';

// ------------------------------------------------------------------ archives

interface TreeNode {
  name: string;
  path: string;
  size: number;
  dir: boolean;
  mtime?: number;
  children: Map<string, TreeNode>;
}

function buildTree(entries: ArchiveEntry[]): TreeNode {
  const root: TreeNode = { name: '', path: '', size: 0, dir: true, children: new Map() };
  for (const e of entries) {
    const parts = e.name.replace(/\\/g, '/').split('/').filter(Boolean);
    let node = root;
    parts.forEach((part, i) => {
      const last = i === parts.length - 1;
      let child = node.children.get(part);
      if (!child) {
        child = { name: part, path: parts.slice(0, i + 1).join('/') + (last && !e.dir ? '' : '/'), size: 0, dir: !last || e.dir, children: new Map() };
        node.children.set(part, child);
      }
      if (last && !e.dir) {
        child.size = e.size;
        child.mtime = e.mtime;
        child.path = e.name;
      }
      node = child;
    });
  }
  const total = (n: TreeNode): number => (n.dir ? (n.size = [...n.children.values()].reduce((a, c) => a + total(c), 0)) : n.size);
  total(root);
  return root;
}

export function ArchiveViewer({ info, mode, openNested }: ViewerProps) {
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const state = useLoad(() => api.preview.archive(info.path), [info.path]);
  return (
    <Loaded state={state} label="Looking inside…">
      {(d) => {
        if (!d.entries.length) return <PreviewMessage icon="archive" title="Nothing to show">{d.note}</PreviewMessage>;
        const sum = summarize(d.entries);
        const filtered = filter ? d.entries.filter((e) => e.name.toLowerCase().includes(filter.toLowerCase())) : d.entries;
        const tree = buildTree(filtered);
        const open = async (entry: string) => {
          if (!openNested) return;
          setBusy(entry);
          try {
            openNested(await api.preview.extract(info.path, entry));
          } finally {
            setBusy(null);
          }
        };
        return (
          <div className="pv-col">
            <Bar>
              <span className="small">{sum.files.toLocaleString()} file{sum.files === 1 ? '' : 's'}{sum.folders ? ` · ${sum.folders.toLocaleString()} folder${sum.folders === 1 ? '' : 's'}` : ''} · {formatBytes(sum.size)} unpacked</span>
              {sum.packed && sum.size ? <span className="badge">{Math.round((1 - sum.packed / sum.size) * 100)}% smaller packed</span> : null}
              {d.note ? <span className="small muted">{d.note}</span> : null}
              <span className="grow" />
              {mode === 'full' ? <input className="input pv-filter" placeholder="Filter" value={filter} onChange={(e) => setFilter(e.target.value)} /> : null}
            </Bar>
            <div className="pv-tree">
              {[...tree.children.values()].sort(sortNodes).slice(0, mode === 'inline' ? 30 : 5000).map((n) => (
                <TreeRow key={n.path} node={n} depth={0} open={open} busy={busy} startOpen={tree.children.size < 4 || !!filter} canOpen={!!openNested} />
              ))}
            </div>
            {mode === 'full' && openNested ? <div className="pv-note small muted">Double-click a file to preview it without unpacking the archive.</div> : null}
          </div>
        );
      }}
    </Loaded>
  );
}

const sortNodes = (a: TreeNode, b: TreeNode) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name, undefined, { numeric: true });

function TreeRow({ node, depth, open, busy, startOpen, canOpen }: { node: TreeNode; depth: number; open: (p: string) => void; busy: string | null; startOpen: boolean; canOpen: boolean }) {
  const [expanded, setExpanded] = useState(startOpen && depth < 1);
  const ext = node.name.includes('.') ? node.name.split('.').pop()!.toLowerCase() : '';
  return (
    <>
      <div className={`tree-row ${node.dir ? 'dir' : ''}`} style={{ paddingLeft: 8 + depth * 16 }} onClick={() => node.dir && setExpanded((x) => !x)} onDoubleClick={() => !node.dir && canOpen && open(node.path)}>
        <span className="tree-caret">{node.dir ? (expanded ? '▾' : '▸') : ''}</span>
        <Icon name={node.dir ? 'folder' : 'other'} size={14} />
        <span className="ellipsis grow">{node.name}</span>
        {busy === node.path ? <span className="spinner" /> : null}
        {ext && !node.dir ? <span className="tree-ext">{ext}</span> : null}
        <span className="num muted small tree-size">{formatBytes(node.size)}</span>
        <span className="num muted small tree-date">{node.mtime ? formatDate(node.mtime) : ''}</span>
      </div>
      {expanded ? [...node.children.values()].sort(sortNodes).slice(0, 2000).map((c) => <TreeRow key={c.path} node={c} depth={depth + 1} open={open} busy={busy} startOpen={false} canOpen={canOpen} />) : null}
    </>
  );
}

// ------------------------------------------------------------------ e-books

export function EpubViewer({ info, mode }: ViewerProps) {
  const [chapter, setChapter] = useState(0);
  const [size, setSize] = useState(17);
  const state = useLoad(async () => {
    const zip = await JSZip.loadAsync(await fetchBytes(info.path, 300 * 1024 * 1024));
    const container = await zip.file('META-INF/container.xml')?.async('string');
    const opfPath = container?.match(/full-path="([^"]+)"/)?.[1] ?? Object.keys(zip.files).find((n) => n.endsWith('.opf'));
    if (!opfPath) throw new Error('This e-book is missing its table of contents.');
    const opf = new DOMParser().parseFromString(await zip.file(opfPath)!.async('string'), 'application/xml');
    const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
    const manifest = new Map<string, { href: string; type: string }>();
    for (const it of [...opf.getElementsByTagName('*')].filter((e) => e.localName === 'item')) manifest.set(it.getAttribute('id') ?? '', { href: it.getAttribute('href') ?? '', type: it.getAttribute('media-type') ?? '' });
    const spine = [...opf.getElementsByTagName('*')].filter((e) => e.localName === 'itemref').map((r) => manifest.get(r.getAttribute('idref') ?? '')).filter((x): x is { href: string; type: string } => !!x && /html/.test(x.type));
    const title = [...opf.getElementsByTagName('*')].find((e) => e.localName === 'title')?.textContent ?? info.name;
    const author = [...opf.getElementsByTagName('*')].find((e) => e.localName === 'creator')?.textContent ?? '';
    return { zip, base, spine, title, author };
  }, [info.path]);
  return (
    <Loaded state={state} label="Opening book…">
      {(book) => (
        <div className="pv-col">
          {mode === 'full' ? (
            <Bar>
              <BarButton icon="chevronLeft" label="Previous chapter" onClick={() => setChapter((c) => Math.max(0, c - 1))} disabled={chapter === 0} />
              <select className="pv-select" value={chapter} onChange={(e) => setChapter(+e.target.value)}>
                {book.spine.map((s, i) => <option key={i} value={i}>{i + 1}. {decodeURIComponent(s.href.split('/').pop()!.replace(/\.x?html?$/, ''))}</option>)}
              </select>
              <BarButton icon="chevronRight" label="Next chapter" onClick={() => setChapter((c) => Math.min(book.spine.length - 1, c + 1))} disabled={chapter >= book.spine.length - 1} />
              <span className="pv-sep" />
              <BarButton icon="minus" label="Smaller text" onClick={() => setSize((s) => Math.max(12, s - 1))} />
              <BarButton icon="plus" label="Larger text" onClick={() => setSize((s) => Math.min(28, s + 1))} />
              <span className="grow" />
              <span className="small muted ellipsis">{book.title}{book.author ? ` — ${book.author}` : ''}</span>
            </Bar>
          ) : null}
          <Chapter book={book} index={mode === 'inline' ? 0 : chapter} size={size} />
        </div>
      )}
    </Loaded>
  );
}

function Chapter({ book, index, size }: { book: { zip: JSZip; base: string; spine: { href: string }[] }; index: number; size: number }) {
  const state = useLoad(async () => {
    const href = book.base + book.spine[index]?.href;
    const dir = href.includes('/') ? href.slice(0, href.lastIndexOf('/') + 1) : '';
    const html = (await book.zip.file(decodeURIComponent(href))?.async('string')) ?? '';
    const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? html;
    const clean = sanitize(body, { allowRemoteImages: false });
    // Pictures inside the book become blob URLs.
    const doc = new DOMParser().parseFromString(`<div>${body}</div>`, 'text/html');
    const srcs = new Map<string, string>();
    for (const img of [...doc.querySelectorAll('img[src], image')]) {
      const src = img.getAttribute('src') ?? img.getAttribute('xlink:href') ?? img.getAttribute('href') ?? '';
      if (!src || /^(data|https?):/.test(src)) continue;
      const p = decodeURIComponent(new URL(src, `https://book/${dir}`).pathname.slice(1));
      const f = book.zip.file(p);
      if (f) srcs.set(src, URL.createObjectURL(await f.async('blob')));
    }
    let out = clean.html;
    const cleanDoc = new DOMParser().parseFromString(`<div>${out}</div>`, 'text/html');
    cleanDoc.querySelectorAll('img').forEach((img, i) => {
      const orig = [...doc.querySelectorAll('img[src]')][i]?.getAttribute('src');
      if (orig && srcs.has(orig)) img.setAttribute('src', srcs.get(orig)!);
    });
    out = cleanDoc.body.firstElementChild!.innerHTML;
    return out;
  }, [book, index]);
  return <Loaded state={state}>{(html) => <div className="pv-paper-wrap"><article className="pv-doc pv-book" style={{ fontSize: size }} onClick={onLinkClick} dangerouslySetInnerHTML={{ __html: html }} /></div>}</Loaded>;
}

// ------------------------------------------------------------------ fonts

const GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!?&@#$%*()[]{}<>/\\«»“”‘’—–…•€£¥¢ÄÖÜßéèêàçñøåæœ';

export function FontViewer({ info, mode }: ViewerProps) {
  const [sample, setSample] = useState('The quick brown fox jumps over the lazy dog');
  const family = useMemo(() => `kp-font-${Math.random().toString(36).slice(2)}`, []);
  const state = useLoad(async () => {
    if (isDemo) throw new Error('Font previews work in the desktop app.');
    const face = new FontFace(family, await fetchBytes(info.path, 60 * 1024 * 1024));
    await face.load();
    document.fonts.add(face);
    return face;
  }, [info.path]);
  useEffect(() => () => { if (state.data) document.fonts.delete(state.data); }, [state.data]);
  return (
    <Loaded state={state} label="Loading font…">
      {() => (
        <div className="pv-font" style={{ fontFamily: `'${family}'` }}>
          <div className="pv-font-hero">Aa</div>
          {mode === 'full' ? <input className="input pv-font-input" value={sample} onChange={(e) => setSample(e.target.value)} style={{ fontFamily: 'inherit' }} aria-label="Sample text" /> : null}
          <div className="pv-font-water">
            {(mode === 'full' ? [12, 16, 20, 28, 36, 48, 64, 80] : [14, 22, 32]).map((s) => (
              <div key={s} className="wf"><span className="wf-size">{s}</span><span style={{ fontSize: s }}>{sample}</span></div>
            ))}
          </div>
          {mode === 'full' ? <div className="pv-glyphs">{[...GLYPHS].map((g, i) => <span key={i}>{g}</span>)}</div> : null}
        </div>
      )}
    </Loaded>
  );
}

// ------------------------------------------------------------------ 3D models

export function ModelViewer({ info, mode }: ViewerProps) {
  const mount = useRef<HTMLDivElement>(null);
  const [wire, setWire] = useState(false);
  const [spin, setSpin] = useState(mode === 'inline');
  const [stats, setStats] = useState<{ vertices: number; triangles: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const api3 = useRef<{ setWire: (w: boolean) => void; setSpin: (s: boolean) => void; reset: () => void } | null>(null);

  useEffect(() => {
    if (isDemo) { setError('3D previews work in the desktop app.'); return; }
    const el = mount.current;
    if (!el) return;
    let disposed = false;
    let cleanup = () => {};
    (async () => {
      const THREE = await import('three');
      const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js');
      const scene = new THREE.Scene();
      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
      renderer.setSize(el.clientWidth, el.clientHeight);
      el.appendChild(renderer.domElement);
      const camera = new THREE.PerspectiveCamera(45, el.clientWidth / el.clientHeight, 0.01, 1e7);
      scene.add(new THREE.HemisphereLight(0xffffff, 0x444466, 1.4));
      const sun = new THREE.DirectionalLight(0xffffff, 1.6);
      sun.position.set(3, 5, 4);
      scene.add(sun);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      const url = fileUrl(info.path);
      const ext = info.ext;
      const material = new THREE.MeshStandardMaterial({ color: 0x8f8fff, metalness: 0.15, roughness: 0.55, side: THREE.DoubleSide });
      let object: import('three').Object3D;
      if (ext === 'glb' || ext === 'gltf') {
        const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
        object = (await new GLTFLoader().loadAsync(url)).scene;
      } else if (ext === 'obj') {
        const { OBJLoader } = await import('three/examples/jsm/loaders/OBJLoader.js');
        object = await new OBJLoader().loadAsync(url);
        object.traverse((o) => { if ((o as import('three').Mesh).isMesh) (o as import('three').Mesh).material = material; });
      } else if (ext === 'stl') {
        const { STLLoader } = await import('three/examples/jsm/loaders/STLLoader.js');
        const g = await new STLLoader().loadAsync(url);
        g.computeVertexNormals();
        object = new THREE.Mesh(g, material);
      } else if (ext === 'ply') {
        const { PLYLoader } = await import('three/examples/jsm/loaders/PLYLoader.js');
        const g = await new PLYLoader().loadAsync(url);
        g.computeVertexNormals();
        object = g.index || g.attributes.normal ? new THREE.Mesh(g, g.attributes.color ? new THREE.MeshStandardMaterial({ vertexColors: true }) : material) : new THREE.Points(g, new THREE.PointsMaterial({ size: 0.01, vertexColors: !!g.attributes.color }));
      } else if (ext === 'fbx') {
        const { FBXLoader } = await import('three/examples/jsm/loaders/FBXLoader.js');
        object = await new FBXLoader().loadAsync(url);
      } else if (ext === '3mf') {
        const { ThreeMFLoader } = await import('three/examples/jsm/loaders/3MFLoader.js');
        object = await new ThreeMFLoader().loadAsync(url);
      } else if (ext === 'dae') {
        const { ColladaLoader } = await import('three/examples/jsm/loaders/ColladaLoader.js');
        object = (await new ColladaLoader().loadAsync(url))!.scene;
      } else throw new Error('This 3D format is not supported yet.');
      if (disposed) return;
      // Centre and frame the model.
      const box = new THREE.Box3().setFromObject(object);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      object.position.sub(center);
      const radius = Math.max(size.x, size.y, size.z) || 1;
      scene.add(object);
      const grid = new THREE.GridHelper(radius * 2, 20, isDark() ? 0x555566 : 0xbbbbcc, isDark() ? 0x333344 : 0xddddee);
      grid.position.y = -size.y / 2;
      scene.add(grid);
      const reset = () => {
        camera.position.set(radius * 1.2, radius * 0.9, radius * 1.6);
        camera.near = radius / 1000;
        camera.far = radius * 1000;
        camera.updateProjectionMatrix();
        controls.target.set(0, 0, 0);
        controls.update();
      };
      reset();
      let vertices = 0;
      let triangles = 0;
      object.traverse((o) => {
        const g = (o as import('three').Mesh).geometry as import('three').BufferGeometry | undefined;
        if (!g?.attributes?.position) return;
        vertices += g.attributes.position.count;
        triangles += g.index ? g.index.count / 3 : g.attributes.position.count / 3;
      });
      setStats({ vertices, triangles: Math.round(triangles) });
      let auto = spin;
      api3.current = {
        setWire: (w) => object.traverse((o) => { const m = (o as import('three').Mesh).material as import('three').MeshStandardMaterial | import('three').MeshStandardMaterial[] | undefined; (Array.isArray(m) ? m : m ? [m] : []).forEach((x) => { if ('wireframe' in x) x.wireframe = w; }); }),
        setSpin: (s) => { auto = s; },
        reset,
      };
      let raf = 0;
      const tick = () => {
        if (auto) object.rotation.y += 0.006;
        controls.update();
        renderer.render(scene, camera);
        raf = requestAnimationFrame(tick);
      };
      tick();
      const ro = new ResizeObserver(() => {
        camera.aspect = el.clientWidth / Math.max(1, el.clientHeight);
        camera.updateProjectionMatrix();
        renderer.setSize(el.clientWidth, el.clientHeight);
      });
      ro.observe(el);
      cleanup = () => {
        cancelAnimationFrame(raf);
        ro.disconnect();
        controls.dispose();
        renderer.dispose();
        renderer.domElement.remove();
      };
    })().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
    return () => { disposed = true; cleanup(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info.path]);

  useEffect(() => api3.current?.setWire(wire), [wire]);
  useEffect(() => api3.current?.setSpin(spin), [spin]);

  if (error) return <PreviewMessage icon="warning" title="This model could not be shown">{error}</PreviewMessage>;
  return (
    <div className="pv-col">
      {mode === 'full' ? (
        <Bar>
          <BarButton icon="grid" label="Wireframe" on={wire} onClick={() => setWire((w) => !w)} />
          <BarButton icon="refresh" label="Turntable" on={spin} onClick={() => setSpin((s) => !s)} />
          <BarButton icon="eye" label="Reset view" onClick={() => api3.current?.reset()} />
          <span className="grow" />
          {stats ? <span className="small muted num">{stats.vertices.toLocaleString()} vertices · {stats.triangles.toLocaleString()} triangles</span> : null}
        </Bar>
      ) : null}
      <div ref={mount} className="pv-3d" />
    </div>
  );
}

// ------------------------------------------------------------------ e-mail, contacts, calendar

export function MailViewer({ info, mode, openNested }: ViewerProps) {
  const [showRemote] = useState(false);
  const state = useLoad(async () => {
    const t = await api.preview.bytes(info.path, 0, 50 * 1024 * 1024);
    const bin = atob(t);
    const mbox = info.ext === 'mbox';
    const raw = mbox ? bin.split(/\r?\nFrom .*\r?\n/)[0].replace(/^From .*\r?\n/, '') : bin;
    return { mail: parseMail(raw), count: mbox ? (bin.match(/(^|\n)From /g) ?? []).length : 1 };
  }, [info.path]);
  return (
    <Loaded state={state} label="Reading message…">
      {({ mail, count }) => <MailBody mail={mail} count={count} mode={mode} showRemote={showRemote} openNested={openNested} />}
    </Loaded>
  );
}

function MailBody({ mail, count, mode, showRemote }: { mail: Mail; count: number; mode: ViewerProps['mode']; showRemote: boolean; openNested?: (p: string) => void }) {
  const cidMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of mail.attachments) if (a.cid && a.contentType.startsWith('image/')) m.set(a.cid, URL.createObjectURL(new Blob([new Uint8Array(a.data)], { type: a.contentType })));
    return m;
  }, [mail]);
  const html = useMemo(() => {
    if (!mail.html) return null;
    const withCid = mail.html.replace(/src=["']cid:([^"']+)["']/gi, (_m, id: string) => (cidMap.has(id) ? `src="${cidMap.get(id)}"` : ''));
    return sanitize(withCid, { allowRemoteImages: showRemote });
  }, [mail, cidMap, showRemote]);
  return (
    <div className="pv-col pv-mail">
      <div className="mail-head">
        <div className="mail-subject">{mail.subject || '(no subject)'}</div>
        <dl className="kv">
          {mail.from ? <><dt>From</dt><dd>{mail.from}</dd></> : null}
          {mail.to ? <><dt>To</dt><dd>{mail.to}</dd></> : null}
          {mail.cc ? <><dt>Cc</dt><dd>{mail.cc}</dd></> : null}
          {mail.date ? <><dt>Date</dt><dd>{new Date(mail.date).toString() === 'Invalid Date' ? mail.date : new Date(mail.date).toLocaleString()}</dd></> : null}
        </dl>
        {count > 1 ? <div className="small muted">First of {count} messages in this mailbox.</div> : null}
        {html?.blockedRemote ? <div className="small muted">{html.blockedRemote} remote image{html.blockedRemote === 1 ? '' : 's'} hidden so the sender cannot tell you opened this.</div> : null}
      </div>
      {mail.attachments.filter((a) => !a.cid || !cidMap.has(a.cid)).length ? (
        <div className="mail-att">
          {mail.attachments.filter((a) => !a.cid || !cidMap.has(a.cid)).map((a, i) => (
            <span key={i} className="badge" title={a.contentType}><Icon name="other" size={12} /> {a.filename} · {formatBytes(a.size)}</span>
          ))}
        </div>
      ) : null}
      {html ? (
        <iframe className="pv-frame" sandbox="" referrerPolicy="no-referrer" title="Message" srcDoc={sandboxDoc(html.html, isDark())} />
      ) : (
        <pre className="pv-doc mail-text">{(mail.text ?? '').slice(0, mode === 'inline' ? 3000 : undefined)}</pre>
      )}
    </div>
  );
}

export function ContactViewer({ info, mode }: ViewerProps) {
  const state = useLoad(async () => parseVcards((await api.preview.text(info.path, 20 * 1024 * 1024)).text), [info.path]);
  return (
    <Loaded state={state}>
      {(cards) => (
        <div className="pv-cards">
          {(mode === 'inline' ? cards.slice(0, 3) : cards.slice(0, 2000)).map((c, i) => (
            <div key={i} className="card pad contact">
              <div className="row">
                <div className="contact-photo">{c.photo ? <img src={c.photo} alt="" /> : <span>{c.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()}</span>}</div>
                <div>
                  <div className="contact-name">{c.name || 'No name'}</div>
                  {c.title || c.org ? <div className="small muted">{[c.title, c.org].filter(Boolean).join(' · ')}</div> : null}
                </div>
              </div>
              <dl className="kv">
                {c.phones.map((p, j) => <FragmentRow key={`p${j}`} k={p.type} v={p.value} open={() => void openNative('call', { to: p.value })} title="Call" />)}
                {c.emails.map((p, j) => <FragmentRow key={`e${j}`} k={p.type === 'other' ? 'email' : p.type} v={p.value} open={() => void openNative('mail', { to: p.value })} title="Write an email" />)}
                {c.addresses.map((p, j) => <FragmentRow key={`a${j}`} k={p.type} v={p.value} open={() => void openNative('maps', { address: p.value.replace(/\s*\n\s*/g, ', ') })} title="Open in Maps" />)}
                {c.urls.map((u, j) => <FragmentRow key={`u${j}`} k="web" v={u} />)}
                {c.birthday ? <FragmentRow k="birthday" v={c.birthday} /> : null}
                {c.note ? <FragmentRow k="note" v={c.note} /> : null}
              </dl>
            </div>
          ))}
          {cards.length > 1 ? <div className="small muted">{cards.length} contacts</div> : null}
        </div>
      )}
    </Loaded>
  );
}

function FragmentRow({ k, v, open, title }: { k: string; v: string; open?: () => void; title?: string }) {
  return <><dt>{k}</dt><dd>{open ? <button className="native-link" title={title} onClick={open}>{v}</button> : v}</dd></>;
}

export function CalendarViewer({ info, mode }: ViewerProps) {
  const state = useLoad(async () => {
    const t = (await api.preview.text(info.path, 20 * 1024 * 1024)).text;
    return parseIcs(t, new Date(1970, 0, 1).getTime(), new Date(2100, 0, 1).getTime()).slice(0, 5000);
  }, [info.path]);
  return (
    <Loaded state={state}>
      {(events) => {
        if (!events.length) return <PreviewMessage icon="calendar" title="No events in this calendar" />;
        const groups = new Map<string, typeof events>();
        for (const e of events) {
          const k = new Date(e.start).toDateString();
          groups.set(k, [...(groups.get(k) ?? []), e]);
        }
        return (
          <div className="pv-agenda">
            {[...groups].slice(0, mode === 'inline' ? 6 : 1000).map(([day, list]) => (
              <div key={day} className="agenda-day">
                <div className="agenda-date">{new Date(list[0].start).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</div>
                {list.map((e) => (
                  <div key={e.uid} className="agenda-event">
                    <span className="num muted small">{e.allDay ? 'All day' : `${new Date(e.start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} – ${new Date(e.end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`}</span>
                    <span className="agenda-title">{e.title}</span>
                    {e.location ? <button className="small native-link" title="Open in Maps" onClick={() => void openNative('maps', { address: e.location })}>{e.location}</button> : null}
                  </div>
                ))}
              </div>
            ))}
          </div>
        );
      }}
    </Loaded>
  );
}

// ------------------------------------------------------------------ SQLite

export function SqliteViewer({ info, mode }: ViewerProps) {
  const [table, setTable] = useState<string | null>(null);
  const [sql, setSql] = useState('');
  const [result, setResult] = useState<{ columns: string[]; values: unknown[][] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const state = useLoad(async () => {
    const [{ default: initSqlJs }, { default: wasmUrl }] = await Promise.all([import('sql.js'), import('sql.js/dist/sql-wasm.wasm?url')]);
    const SQL = await initSqlJs({ locateFile: () => wasmUrl });
    const db = new SQL.Database(new Uint8Array(await fetchBytes(info.path, 400 * 1024 * 1024)));
    const tables = (db.exec("SELECT name, type, sql FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name")[0]?.values ?? []).map((r) => ({ name: String(r[0]), type: String(r[1]), sql: String(r[2] ?? '') }));
    const counts = new Map<string, number>();
    for (const t of tables.slice(0, 200)) {
      try {
        counts.set(t.name, Number(db.exec(`SELECT COUNT(*) FROM "${t.name.replace(/"/g, '""')}"`)[0]?.values[0][0] ?? 0));
      } catch {
        /* virtual table */
      }
    }
    return { db, tables, counts };
  }, [info.path]);
  useEffect(() => () => state.data?.db.close(), [state.data]);
  const run = (db: { exec: (s: string) => { columns: string[]; values: unknown[][] }[] }, q: string) => {
    // Read-only: only queries that read are allowed.
    if (!/^\s*(select|with|pragma\s+table_info|explain)\b/i.test(q) || /;\s*\S/.test(q.trim().replace(/;$/, ''))) {
      setErr('Only single read-only queries (SELECT) are allowed.');
      return;
    }
    try {
      const r = db.exec(q)[0];
      setResult(r ?? { columns: [], values: [] });
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <Loaded state={state} label="Opening database…">
      {({ db, tables, counts }) => {
        const pick = (name: string) => {
          setTable(name);
          const q = `SELECT * FROM "${name.replace(/"/g, '""')}" LIMIT 200`;
          setSql(q);
          run(db, q);
        };
        if (!table && tables[0]) setTimeout(() => pick(tables[0].name), 0);
        return (
          <div className="pv-split">
            <aside className="pv-side">
              <div className="pv-side-title">{tables.length} table{tables.length === 1 ? '' : 's'}</div>
              {tables.map((t) => (
                <button key={t.name} className={`pv-side-item ${table === t.name ? 'on' : ''}`} onClick={() => pick(t.name)}>
                  <span className="ellipsis">{t.name}</span><span className="small muted num">{counts.get(t.name)?.toLocaleString() ?? ''}</span>
                </button>
              ))}
            </aside>
            <div className="pv-col">
              {mode === 'full' ? (
                <Bar>
                  <form className="pv-search grow" onSubmit={(e) => { e.preventDefault(); run(db, sql); }}>
                    <input className="input pv-filter mono" style={{ width: '100%' }} value={sql} onChange={(e) => setSql(e.target.value)} aria-label="Query" />
                  </form>
                  <BarButton icon="play" label="Run query" onClick={() => run(db, sql)} />
                </Bar>
              ) : null}
              {err ? <div className="pv-note small" style={{ color: 'var(--danger)' }}>{err}</div> : null}
              {result ? (
                <div className="pv-table-wrap">
                  <table className="pv-table">
                    <thead><tr>{result.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
                    <tbody>{result.values.slice(0, 1000).map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j} className={typeof v === 'number' ? 'n' : ''}>{v instanceof Uint8Array ? `‹${v.length} bytes›` : v === null ? <span className="muted">NULL</span> : String(v).slice(0, 300)}</td>)}</tr>)}</tbody>
                  </table>
                </div>
              ) : null}
            </div>
          </div>
        );
      }}
    </Loaded>
  );
}

// ------------------------------------------------------------------ apps & folders

export function AppViewer({ info }: ViewerProps) {
  const [icon, setIcon] = useState<string | null>(null);
  useEffect(() => void api.files.icon(info.path).then(setIcon).catch(() => undefined), [info.path]);
  const fields = info.app ?? {};
  return (
    <div className="pv-app">
      <div className="pv-app-icon">{icon ? <img src={icon} alt="" /> : <Icon name="app" size={64} stroke={1.2} />}</div>
      <div className="pv-app-name">{fields.Name ?? info.name.replace(/\.(app|exe|msi|appimage|deb|rpm|dmg|pkg)$/i, '')}</div>
      <div className="muted small">{info.format}{info.size ? ` · ${formatBytes(info.size)}` : ''}</div>
      {Object.keys(fields).length ? (
        <dl className="kv pv-app-kv">{Object.entries(fields).filter(([k]) => k !== 'Name').map(([k, v]) => <FragmentRow key={k} k={k} v={v} />)}</dl>
      ) : null}
    </div>
  );
}

export function FolderViewer({ info }: ViewerProps) {
  const f = info.folder;
  if (!f) return <PreviewMessage icon="folder" title={info.name} />;
  const kinds = Object.entries(f.kinds).sort((a, b) => b[1] - a[1]);
  const total = kinds.reduce((n, [, c]) => n + c, 0);
  return (
    <div className="pv-folder">
      {f.images.length ? (
        <div className={`pv-mosaic n${Math.min(f.images.length, 9)}`}>
          {f.images.slice(0, 9).map((p) => <img key={p} src={isDemo ? '' : fileUrl(p)} alt="" loading="lazy" />)}
        </div>
      ) : <div className="pv-folder-icon"><Icon name="folder" size={72} stroke={1.1} /></div>}
      <div className="pv-folder-stats">
        <div className="stat"><span className="v">{f.files.toLocaleString()}{f.truncated ? '+' : ''}</span><span className="l">files</span></div>
        <div className="stat"><span className="v">{f.folders.toLocaleString()}</span><span className="l">folders</span></div>
        <div className="stat"><span className="v">{formatBytes(f.size)}{f.truncated ? '+' : ''}</span><span className="l">in total</span></div>
      </div>
      {total ? (
        <>
          <div className="bar">{kinds.map(([k, c]) => <i key={k} style={{ width: `${(c / total) * 100}%`, background: KIND_COLOR[k as keyof typeof KIND_COLOR] ?? 'var(--c-other)' }} />)}</div>
          <div className="pv-kind-legend small">{kinds.slice(0, 8).map(([k, c]) => <span key={k}><i style={{ background: KIND_COLOR[k as keyof typeof KIND_COLOR] ?? 'var(--c-other)' }} />{k} {c}</span>)}</div>
        </>
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ hex

export function HexViewer({ info, mode }: ViewerProps) {
  const [offset, setOffset] = useState(0);
  const PAGE = 64 * 1024;
  const state = useLoad(async () => {
    const b64 = await api.preview.bytes(info.path, offset, PAGE);
    const bin = atob(b64);
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  }, [info.path, offset]);
  return (
    <Loaded state={state}>
      {(b) => {
        const lines = hexLines(mode === 'inline' ? b.subarray(0, 512) : b, offset);
        const strings = mode === 'full' ? (bytesToText(b, 'latin1').match(/[\x20-\x7e]{8,}/g) ?? []).slice(0, 30) : [];
        return (
          <div className="pv-col">
            <Bar>
              <span className="badge">{info.format}</span>
              <span className="small muted">{formatBytes(info.size)}</span>
              <span className="grow" />
              {mode === 'full' && info.size > PAGE ? (
                <>
                  <BarButton icon="chevronLeft" label="Previous 64 KB" onClick={() => setOffset((o) => Math.max(0, o - PAGE))} disabled={offset === 0} />
                  <span className="small num muted">{formatBytes(offset)} – {formatBytes(Math.min(info.size, offset + PAGE))}</span>
                  <BarButton icon="chevronRight" label="Next 64 KB" onClick={() => setOffset((o) => (o + PAGE < info.size ? o + PAGE : o))} disabled={offset + PAGE >= info.size} />
                </>
              ) : null}
            </Bar>
            <div className="pv-hex mono">
              {lines.map((l) => (
                <div key={l.offset}><span className="hx-off">{l.offset}</span><span className="hx-bytes">{l.hex}</span><span className="hx-ascii">{l.ascii}</span></div>
              ))}
            </div>
            {strings.length ? <div className="pv-strings small"><span className="muted">Readable text inside: </span>{strings.join(' · ')}</div> : null}
          </div>
        );
      }}
    </Loaded>
  );
}
