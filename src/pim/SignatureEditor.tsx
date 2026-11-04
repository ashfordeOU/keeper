// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Signatures and how an account writes, in Settings → Mail & Calendar: a
// what-you-see editor for rich signatures (pictures, links, fonts, colours),
// several per address with a default for new mail, replies and forwards,
// signatures brought in from your web mail or other mail apps, the account's
// font, size, colour, format, quote and reply options, and an alias's own
// outgoing server.

import { useEffect, useRef, useState } from 'react';
import { FONTS, SIZES, sanitizeSignature, signaturesOf, type ComposeStyle, type Signature } from '../../core/pim/signatures';
import type { Account, Identity, ServerSettings } from '../../core/pim/types';
import { api } from '../api';
import { Icon } from '../components/Icon';
import { Modal, Toggle } from '../components/ui';
import { useStore } from '../state';
import '../styles/pim-import.css';

const clean = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
const uid = () => Math.random().toString(36).slice(2, 10);
const COLOURS = ['#1c1c1e', '#5b5bf0', '#0a84ff', '#2f9e62', '#d98a00', '#d0342c', '#8e8e93'];

/** A picture from a file as a data: URL, made smaller when it is large (signatures stay light). */
function pickPicture(): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/gif,image/webp';
    input.onchange = () => {
      const f = input.files?.[0];
      if (!f) return resolve(null);
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, 400 / img.width, 200 / img.height);
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL(f.type === 'image/jpeg' ? 'image/jpeg' : 'image/png', 0.9));
        URL.revokeObjectURL(img.src);
      };
      img.onerror = () => resolve(null);
      img.src = URL.createObjectURL(f);
    };
    input.click();
  });
}

/** The signature editor: what you see is what is sent (cleaned when saved). */
export function SignatureEditor({ html, onChange, label }: { html: string; onChange: (html: string) => void; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { if (ref.current && ref.current.innerHTML !== html) ref.current.innerHTML = html; }, [html]);
  const cmd = (c: string, v?: string) => {
    ref.current?.focus();
    document.execCommand('styleWithCSS', false, 'true');
    document.execCommand(c, false, v);
    onChange(ref.current?.innerHTML ?? '');
  };
  return (
    <div className="sig-editor">
      <div className="sig-tools" role="toolbar" aria-label={`${label}: formatting`}>
        <button type="button" className="btn xs ghost" title="Bold" aria-label="Bold" onMouseDown={(e) => { e.preventDefault(); cmd('bold'); }}><b>B</b></button>
        <button type="button" className="btn xs ghost" title="Italic" aria-label="Italic" onMouseDown={(e) => { e.preventDefault(); cmd('italic'); }}><i>I</i></button>
        <button type="button" className="btn xs ghost" title="Underline" aria-label="Underline" onMouseDown={(e) => { e.preventDefault(); cmd('underline'); }}><u>U</u></button>
        <select className="input xs" aria-label="Font" defaultValue="" onChange={(e) => { if (e.target.value) cmd('fontName', FONTS.find((f) => f.id === e.target.value)!.css); e.target.value = ''; }}>
          <option value="">Font</option>{FONTS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
        </select>
        <select className="input xs" aria-label="Size" defaultValue="" onChange={(e) => { if (e.target.value) cmd('fontSize', e.target.value); e.target.value = ''; }}>
          <option value="">Size</option><option value="2">Small</option><option value="3">Normal</option><option value="4">Large</option><option value="5">Larger</option>
        </select>
        <span className="sig-swatches" role="group" aria-label="Colour">
          {COLOURS.map((c) => <button key={c} type="button" className="sig-swatch" style={{ background: c }} title={`Colour ${c}`} aria-label={`Colour ${c}`} onMouseDown={(e) => { e.preventDefault(); cmd('foreColor', c); }} />)}
        </span>
        <button type="button" className="btn xs ghost" title="Link" aria-label="Link" onMouseDown={(e) => { e.preventDefault(); const url = window.prompt('Link address (https://, mailto: or tel:)', 'https://'); if (url && /^(https?:|mailto:|tel:)/i.test(url)) cmd('createLink', url); }}><Icon name="link" size={13} /></button>
        <button type="button" className="btn xs ghost" title="Picture or logo" aria-label="Picture or logo" onMouseDown={(e) => { e.preventDefault(); void pickPicture().then((src) => src && cmd('insertImage', src)); }}><Icon name="image" size={13} /></button>
      </div>
      <div ref={ref} className="sig-area" contentEditable suppressContentEditableWarning role="textbox" aria-multiline aria-label={label} data-testid="sig-area" onInput={() => onChange(ref.current?.innerHTML ?? '')} />
    </div>
  );
}

/** One address's signatures, with the default for each kind of message. */
export function AddressSignatures({ account, ident, onChange }: { account: Account; ident: Identity; onChange: (p: Partial<Identity>) => void }) {
  const { toast } = useStore();
  const list = signaturesOf(ident);
  const [found, setFound] = useState<{ source: string; name: string; html: string; email?: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const put = (l: Signature[]) => onChange({ signatures: l, signature: undefined });
  const defaults = ident.signatureDefaults ?? {};
  const look = async () => {
    setBusy(true);
    try {
      const got = await api.pim.signatureSources(account.id);
      if (!got.length) toast('No signatures found in your web mail or other mail apps');
      else setFound(got.sort((a, b) => Number(b.email?.toLowerCase() === ident.email.toLowerCase()) - Number(a.email?.toLowerCase() === ident.email.toLowerCase())));
    } catch (e) {
      toast(clean(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="col" style={{ gap: 8 }} data-testid="address-signatures">
      {list.map((s, i) => (
        <div key={s.id} className="sig-card">
          <div className="row" style={{ gap: 8 }}>
            <input className="input sm grow" aria-label="Signature name" value={s.name} onChange={(e) => put(list.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
            <button className="btn xs ghost icon" title="Remove this signature" aria-label="Remove this signature" onClick={() => put(list.filter((_, j) => j !== i))}><Icon name="trash" size={12} /></button>
          </div>
          <SignatureEditor html={s.html} label={`Signature “${s.name}”`} onChange={(h) => put(list.map((x, j) => (j === i ? { ...x, html: h } : x)))} />
        </div>
      ))}
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button className="btn sm ghost" onClick={() => put([...list, { id: uid(), name: list.length ? `Signature ${list.length + 1}` : 'Signature', html: ident.name ? `${ident.name.replace(/</g, '&lt;')}` : '' }])} data-testid="sig-add"><Icon name="plus" size={12} /> New signature</button>
        <button className="btn sm ghost" disabled={busy} onClick={() => void look()} data-testid="sig-import">{busy ? <span className="spinner" /> : <Icon name="down" size={12} />} Bring in a signature</button>
      </div>
      {list.length ? (
        <div className="sig-defaults" role="group" aria-label="Which signature goes where">
          {(['new', 'reply', 'forward'] as const).map((k) => (
            <label key={k} className="small">{k === 'new' ? 'New mail' : k === 'reply' ? 'Replies' : 'Forwards'}
              <select className="input sm" value={defaults[k] === undefined ? 'auto' : defaults[k]} onChange={(e) => onChange({ signatureDefaults: { ...defaults, [k]: e.target.value === 'auto' ? undefined : e.target.value } })} data-testid={`sig-default-${k}`}>
                <option value="auto">Automatic ({k !== 'new' && account.signatureOnReplies === false ? 'none' : list[0].name})</option>
                <option value="">None</option>
                {list.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </label>
          ))}
        </div>
      ) : null}
      {found ? (
        <Modal title="Bring in a signature" onClose={() => setFound(null)} width={560} testId="sig-found">
          <div className="col" style={{ gap: 8 }}>
            {found.map((f, i) => (
              <div key={i} className="sig-card">
                <div className="row small" style={{ gap: 8 }}><b className="grow">{f.source} · {f.name}</b><button className="btn xs primary" onClick={() => { put([...list, { id: uid(), name: `${f.source}`, html: sanitizeSignature(f.html) }]); setFound(null); toast('Signature added'); }}>Use this</button></div>
                <div className="sig-preview" dangerouslySetInnerHTML={{ __html: sanitizeSignature(f.html) }} />
              </div>
            ))}
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

/** An alias that must go out through its own server (More settings). */
export function AliasServer({ account, ident, onChange }: { account: Account; ident: Identity; onChange: (p: Partial<Identity>) => void }) {
  const { toast } = useStore();
  const s: ServerSettings = ident.smtp ?? { host: '', port: 587, security: 'starttls', user: ident.email };
  const [pass, setPass] = useState('');
  const set = (p: Partial<ServerSettings>) => onChange({ smtp: { ...s, ...p } });
  return (
    <details className="small" data-testid="alias-server">
      <summary>Its own outgoing server</summary>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
        <input className="input sm" placeholder="smtp.example.com" aria-label="Outgoing server" value={s.host} onChange={(e) => set({ host: e.target.value.trim() })} />
        <input className="input sm" style={{ width: 70 }} type="number" aria-label="Port" value={s.port} onChange={(e) => set({ port: Number(e.target.value) })} />
        <select className="input sm" aria-label="Security" value={s.security} onChange={(e) => set({ security: e.target.value as ServerSettings['security'] })}><option value="tls">SSL/TLS</option><option value="starttls">STARTTLS</option></select>
        <input className="input sm" placeholder="User name" aria-label="User name" value={s.user ?? ''} onChange={(e) => set({ user: e.target.value })} />
        <input className="input sm" type="password" placeholder="Password" aria-label="Password" value={pass} onChange={(e) => setPass(e.target.value)} />
        <button className="btn xs" disabled={!pass} onClick={() => void api.pim.setAliasPassword(account.id, ident.email, pass).then(() => { setPass(''); toast('Password kept in your keychain'); })}>Keep password</button>
        {ident.smtp ? <button className="btn xs ghost" onClick={() => { onChange({ smtp: undefined }); void api.pim.setAliasPassword(account.id, ident.email, ''); }}>Use the account’s server</button> : null}
      </div>
    </details>
  );
}

/** How an account writes: font, size, colour, format, the quote, Reply All and forwards. */
export function AccountWriting({ a }: { a: Account }) {
  const c: ComposeStyle = a.compose ?? {};
  const set = (p: Partial<ComposeStyle>) => void api.pim.updateAccount(a.id, { compose: { ...c, ...p } });
  return (
    <div className="writing-grid" data-testid="account-writing">
      <label className="small">Font
        <select className="input sm" value={c.font ?? 'system'} onChange={(e) => set({ font: e.target.value })}>{FONTS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}</select>
      </label>
      <label className="small">Size
        <select className="input sm" value={c.size ?? ''} onChange={(e) => set({ size: e.target.value || undefined })}><option value="">Usual</option>{SIZES.map((s) => <option key={s} value={s}>{s.replace('px', '')}</option>)}</select>
      </label>
      <label className="small">Colour
        <input type="color" className="input sm" value={c.color ?? '#1c1c1e'} onChange={(e) => set({ color: e.target.value })} aria-label="Text colour" />
      </label>
      <label className="small">Format
        <select className="input sm" value={c.format ?? 'rich'} onChange={(e) => set({ format: e.target.value as ComposeStyle['format'] })}><option value="rich">Rich text</option><option value="plain">Plain text</option></select>
      </label>
      <label className="small">Your answer
        <select className="input sm" value={c.quote ?? 'above'} onChange={(e) => set({ quote: e.target.value as ComposeStyle['quote'] })}><option value="above">Above the quote</option><option value="below">Below the quote</option></select>
      </label>
      <label className="row small" style={{ gap: 8 }}><Toggle on={!!c.replyAll} onChange={(v) => set({ replyAll: v })} /> Reply answers everyone</label>
      <label className="row small" style={{ gap: 8 }}><Toggle on={c.forwardAttachments !== false} onChange={(v) => set({ forwardAttachments: v })} /> Forwards keep attachments</label>
      <label className="row small" style={{ gap: 8 }}><Toggle on={a.signatureOnReplies !== false} onChange={(v) => void api.pim.updateAccount(a.id, { signatureOnReplies: v })} /> Signature on replies and forwards</label>
    </div>
  );
}
