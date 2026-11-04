// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// "Save a copy…": the format, its quality, the colour profile and the photo's
// details (kept, without the place, or none), and a way to convert many
// pictures at once through Convert.

import { useState } from 'react';
import type { PhotoInfo } from '../../../core/api-photo';
import { outputFormat, type PhotoRecipe } from '../../../core/photo-edit';
import { formatInfo, SAVE_FORMATS, type SaveFormat } from '../../../core/photo-formats';
import { api } from '../../api';
import { Modal } from '../../components/ui';
import { useStore } from '../../state';

export function SaveSheet({ info, recipe, onClose, onSave }: { info: PhotoInfo; recipe: PhotoRecipe; onClose: () => void; onSave: (r: PhotoRecipe) => void }) {
  const { go, info: sys } = useStore();
  const platform = sys?.platform ?? 'any';
  const [r, setR] = useState<PhotoRecipe>(recipe);
  const ext = info.name.replace(/^.*\./, '');
  const fmt: SaveFormat = outputFormat(r, ext, info.alpha, platform);
  const f = formatInfo(fmt);
  const quality = r.quality || (fmt === 'avif' ? 60 : fmt === 'webp' ? 88 : 90);
  const many = async () => {
    const files = await api.settings.pickFiles({ title: 'Choose pictures to convert', extensions: ['jpg', 'jpeg', 'png', 'webp', 'avif', 'heic', 'heif', 'tif', 'tiff', 'gif', 'bmp', 'ico', 'svg', 'psd', 'dng', 'cr2', 'cr3', 'nef', 'arw', 'raf', 'orf', 'rw2'] });
    if (files.length) { onClose(); go({ name: 'convert', arg: JSON.stringify({ tool: 'convert.to', files }) }); }
  };
  return (
    <Modal title="Save a copy" onClose={onClose} width={440} testId="ph-save-sheet">
      <div className="insp ph-save">
        <label className="insp-field">Format
          <select className="input" value={r.format} onChange={(e) => setR({ ...r, format: e.target.value as PhotoRecipe['format'] })} data-testid="ph-format">
            <option value="same">Same as now ({formatInfo(outputFormat({ ...r, format: 'same' }, ext, info.alpha, platform)).label})</option>
            {SAVE_FORMATS.map((x) => { const ok = info.formats.find((y) => y.id === x.id)?.ok !== false; return <option key={x.id} value={x.id} disabled={!ok}>{x.label} · {ok ? x.note : 'needs a Mac'}</option>; })}
          </select>
        </label>
        {/^(heic|heif|hif)$/i.test(ext) && info.formats.some((x) => x.id === 'heic' && !x.ok) ? <p className="insp-help">{info.formats.find((x) => x.id === 'heic')?.why} “Same as now” saves a JPEG.</p> : null}
        {r.format !== 'same' && fmt !== r.format ? <p className="insp-help">Saved as {f.label}, so the see-through parts stay see-through.</p> : null}
        {f.quality ? (
          <div className="insp-row">
            <label htmlFor="ph-q">Quality</label>
            <input id="ph-q" type="range" min={30} max={100} value={quality} onChange={(e) => setR({ ...r, quality: Number(e.target.value) })} data-testid="ph-quality" />
            <output htmlFor="ph-q">{quality}</output>
          </div>
        ) : null}
        {f.profile ? (
          <label className="insp-field">Colours
            <select className="input" value={r.profile} onChange={(e) => setR({ ...r, profile: e.target.value as PhotoRecipe['profile'] })} data-testid="ph-profile">
              <option value="keep">Keep the picture’s colour profile</option><option value="srgb">Standard colours (sRGB), for the web</option>
            </select>
          </label>
        ) : null}
        {f.metadata ? (
          <label className="insp-field">Details (date, camera, place)
            <select className="input" value={r.metadata} onChange={(e) => setR({ ...r, metadata: e.target.value as PhotoRecipe['metadata'] })} data-testid="ph-metadata">
              <option value="keep">Keep them</option><option value="no-location">Keep, without where it was taken</option><option value="strip">Remove them all</option>
            </select>
          </label>
        ) : <p className="insp-help">{f.label} does not keep a photo’s details.</p>}
        {info.hasLocation && f.metadata && r.metadata === 'keep' ? <p className="insp-help">This photo says where it was taken.</p> : null}
        {info.frames && info.frames > 1 && f.frames ? (
          <label className="insp-field">Moving picture
            <select className="input" value={r.frames} onChange={(e) => setR({ ...r, frames: e.target.value as PhotoRecipe['frames'] })}>
              <option value="all">Every frame ({info.frames})</option><option value="first">First frame only</option>
            </select>
          </label>
        ) : null}
        <div className="row ph-save-actions">
          <button className="btn sm ph-link" onClick={() => void many()} data-testid="ph-many">Convert many pictures…</button>
          <span className="grow" />
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={() => onSave(r)} data-testid="ph-save-copy">Save a copy</button>
        </div>
      </div>
    </Modal>
  );
}
