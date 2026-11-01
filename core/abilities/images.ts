// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Making and editing pictures with the service the person chose. Every
// provider returns image bytes; Keeper saves them into the library.
//
//   openai         OpenAI Images (generations, edits)
//   xai            xAI's image generation (OpenAI-style /v1/images/generations)
//   gemini         Gemini's image-output models (generateContent)
//   stability      Stability AI (Stable Image Core)
//   automatic1111  a local Stable Diffusion web UI (txt2img, img2img)
//   comfyui        a local ComfyUI with a simple text-to-image graph

import type { ImageProviderId } from './config';

export interface ImageDeps {
  fetch: typeof fetch;
  key?: string;
  model?: string;
  /** automatic1111 / comfyui address */
  localUrl?: string;
}

export interface MadeImage {
  bytes: Buffer;
  mime: string;
  /** what the service changed the prompt to, when it says */
  revised?: string;
}

export const IMAGE_PROVIDERS: { id: ImageProviderId; label: string; needsKey: boolean; local: boolean; defaultModel: string; edits: boolean }[] = [
  { id: 'openai', label: 'OpenAI', needsKey: true, local: false, defaultModel: 'gpt-image-1', edits: true },
  { id: 'xai', label: 'xAI', needsKey: true, local: false, defaultModel: 'grok-imagine-image', edits: false },
  { id: 'gemini', label: 'Google Gemini', needsKey: true, local: false, defaultModel: 'gemini-2.5-flash-image', edits: true },
  { id: 'stability', label: 'Stability AI', needsKey: true, local: false, defaultModel: 'core', edits: false },
  { id: 'automatic1111', label: 'Stable Diffusion web UI (on this computer)', needsKey: false, local: true, defaultModel: '', edits: true },
  { id: 'comfyui', label: 'ComfyUI (on this computer)', needsKey: false, local: true, defaultModel: '', edits: false },
];

async function ok(res: Response, who: string): Promise<Response> {
  if (res.ok) return res;
  let msg = '';
  try {
    msg = ((await res.json()) as { error?: { message?: string } | string }).error as string;
    if (typeof msg === 'object') msg = (msg as { message?: string }).message ?? '';
  } catch {
    /* no details */
  }
  throw new Error(`${who} answered ${res.status}${msg ? `: ${String(msg).slice(0, 200)}` : ''}`);
}

const b64 = (s: string) => Buffer.from(s, 'base64');

export function parseSize(size: string | undefined): { w: number; h: number } {
  const m = String(size ?? '').match(/^(\d{2,4})x(\d{2,4})$/);
  return m ? { w: Number(m[1]), h: Number(m[2]) } : { w: 1024, h: 1024 };
}

export async function generateImages(provider: ImageProviderId, prompt: string, o: { size?: string; count?: number }, d: ImageDeps): Promise<MadeImage[]> {
  const n = Math.max(1, Math.min(4, Math.round(o.count ?? 1)));
  const model = d.model || IMAGE_PROVIDERS.find((p) => p.id === provider)!.defaultModel;
  switch (provider) {
    case 'openai':
    case 'xai': {
      const url = provider === 'openai' ? 'https://api.openai.com/v1/images/generations' : 'https://api.x.ai/v1/images/generations';
      const body: Record<string, unknown> = { model, prompt, n };
      if (provider === 'openai') body.size = o.size || '1024x1024';
      else body.response_format = 'b64_json';
      const j = (await (await ok(await d.fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${d.key ?? ''}` }, body: JSON.stringify(body) }), provider === 'openai' ? 'OpenAI' : 'xAI')).json()) as { data?: { b64_json?: string; url?: string; revised_prompt?: string }[] };
      return Promise.all((j.data ?? []).map(async (x) => ({ bytes: x.b64_json ? b64(x.b64_json) : Buffer.from(await (await d.fetch(x.url!)).arrayBuffer()), mime: 'image/png', revised: x.revised_prompt })));
    }
    case 'gemini': {
      const out: MadeImage[] = [];
      for (let i = 0; i < n; i++) {
        const j = (await (await ok(await d.fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': d.key ?? '' }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ['IMAGE', 'TEXT'] } }) }), 'Gemini')).json()) as { candidates?: { content?: { parts?: { inlineData?: { mimeType: string; data: string } }[] } }[] };
        for (const p of j.candidates?.[0]?.content?.parts ?? []) if (p.inlineData) out.push({ bytes: b64(p.inlineData.data), mime: p.inlineData.mimeType });
      }
      return out;
    }
    case 'stability': {
      const out: MadeImage[] = [];
      const { w, h } = parseSize(o.size);
      const ratio = w === h ? '1:1' : w > h ? (w / h > 1.6 ? '16:9' : '3:2') : h / w > 1.6 ? '9:16' : '2:3';
      for (let i = 0; i < n; i++) {
        const form = new FormData();
        form.append('prompt', prompt);
        form.append('aspect_ratio', ratio);
        form.append('output_format', 'png');
        const res = await ok(await d.fetch(`https://api.stability.ai/v2beta/stable-image/generate/${model || 'core'}`, { method: 'POST', headers: { authorization: `Bearer ${d.key ?? ''}`, accept: 'image/*' }, body: form }), 'Stability AI');
        out.push({ bytes: Buffer.from(await res.arrayBuffer()), mime: 'image/png' });
      }
      return out;
    }
    case 'automatic1111': {
      const { w, h } = parseSize(o.size);
      const j = (await (await ok(await d.fetch(`${(d.localUrl ?? 'http://127.0.0.1:7860').replace(/\/+$/, '')}/sdapi/v1/txt2img`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt, width: w, height: h, batch_size: n, steps: 25 }) }), 'Stable Diffusion web UI')).json()) as { images?: string[] };
      return (j.images ?? []).map((x) => ({ bytes: b64(x), mime: 'image/png' }));
    }
    case 'comfyui': {
      const base = (d.localUrl ?? 'http://127.0.0.1:8188').replace(/\/+$/, '');
      const { w, h } = parseSize(o.size);
      const graph = comfyGraph(prompt, w, h, n, d.model || 'sd_xl_base_1.0.safetensors');
      const { prompt_id } = (await (await ok(await d.fetch(`${base}/prompt`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: graph }) }), 'ComfyUI')).json()) as { prompt_id: string };
      for (let i = 0; i < 300; i++) {
        const hist = (await (await d.fetch(`${base}/history/${prompt_id}`)).json()) as Record<string, { outputs?: Record<string, { images?: { filename: string; subfolder: string; type: string }[] }> }>;
        const imgs = Object.values(hist[prompt_id]?.outputs ?? {}).flatMap((o2) => o2.images ?? []);
        if (imgs.length) return Promise.all(imgs.map(async (im) => ({ bytes: Buffer.from(await (await d.fetch(`${base}/view?filename=${encodeURIComponent(im.filename)}&subfolder=${encodeURIComponent(im.subfolder)}&type=${im.type}`)).arrayBuffer()), mime: 'image/png' })));
        await new Promise((r) => setTimeout(r, 1000));
      }
      throw new Error('ComfyUI did not finish in five minutes');
    }
  }
}

/** A minimal text-to-image graph for ComfyUI's API (checkpoint, prompts, sampler, decode, save). */
export function comfyGraph(prompt: string, w: number, h: number, n: number, ckpt: string): Record<string, unknown> {
  return {
    '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: ckpt } },
    '2': { class_type: 'CLIPTextEncode', inputs: { text: prompt, clip: ['1', 1] } },
    '3': { class_type: 'CLIPTextEncode', inputs: { text: 'blurry, low quality', clip: ['1', 1] } },
    '4': { class_type: 'EmptyLatentImage', inputs: { width: w, height: h, batch_size: n } },
    '5': { class_type: 'KSampler', inputs: { model: ['1', 0], positive: ['2', 0], negative: ['3', 0], latent_image: ['4', 0], seed: Math.floor(Math.random() * 2 ** 31), steps: 25, cfg: 7, sampler_name: 'euler', scheduler: 'normal', denoise: 1 } },
    '6': { class_type: 'VAEDecode', inputs: { samples: ['5', 0], vae: ['1', 2] } },
    '7': { class_type: 'SaveImage', inputs: { images: ['6', 0], filename_prefix: 'keeper' } },
  };
}

export async function editImage(provider: ImageProviderId, image: { bytes: Buffer; mime: string; name: string }, prompt: string, d: ImageDeps): Promise<MadeImage[]> {
  const model = d.model || IMAGE_PROVIDERS.find((p) => p.id === provider)!.defaultModel;
  switch (provider) {
    case 'openai': {
      const form = new FormData();
      form.append('model', model);
      form.append('prompt', prompt);
      form.append('image', new Blob([new Uint8Array(image.bytes)], { type: image.mime }), image.name);
      const j = (await (await ok(await d.fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { authorization: `Bearer ${d.key ?? ''}` }, body: form }), 'OpenAI')).json()) as { data?: { b64_json?: string }[] };
      return (j.data ?? []).filter((x) => x.b64_json).map((x) => ({ bytes: b64(x.b64_json!), mime: 'image/png' }));
    }
    case 'gemini': {
      const j = (await (await ok(await d.fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': d.key ?? '' }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }, { inlineData: { mimeType: image.mime, data: image.bytes.toString('base64') } }] }], generationConfig: { responseModalities: ['IMAGE', 'TEXT'] } }) }), 'Gemini')).json()) as { candidates?: { content?: { parts?: { inlineData?: { mimeType: string; data: string } }[] } }[] };
      return (j.candidates?.[0]?.content?.parts ?? []).filter((p) => p.inlineData).map((p) => ({ bytes: b64(p.inlineData!.data), mime: p.inlineData!.mimeType }));
    }
    case 'automatic1111': {
      const j = (await (await ok(await d.fetch(`${(d.localUrl ?? 'http://127.0.0.1:7860').replace(/\/+$/, '')}/sdapi/v1/img2img`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt, init_images: [image.bytes.toString('base64')], denoising_strength: 0.6, steps: 25 }) }), 'Stable Diffusion web UI')).json()) as { images?: string[] };
      return (j.images ?? []).map((x) => ({ bytes: b64(x), mime: 'image/png' }));
    }
    default:
      throw new Error(`${IMAGE_PROVIDERS.find((p) => p.id === provider)?.label ?? provider} cannot edit pictures in Keeper; choose OpenAI, Gemini or the Stable Diffusion web UI for edits`);
  }
}

/** "a red fox, watercolour" → "a-red-fox-watercolour" */
export function imageFileName(prompt: string, at: Date, i: number, ext = 'png'): string {
  const slug = prompt.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'picture';
  const stamp = at.toISOString().slice(0, 16).replace(/[:T]/g, '-');
  return `${stamp} ${slug}${i ? `-${i + 1}` : ''}.${ext}`;
}
