// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// The background-removal models: a small fast one and a larger, cleaner one.
// Both are downloaded once from their published release, checked against a
// pinned SHA-256 and run on this computer with ONNX Runtime. Both are openly
// licensed for any use, commercial included (Apache-2.0).

export type CutoutModelId = 'fast' | 'best';

export interface CutoutModel {
  id: CutoutModelId;
  name: string;
  line: string;
  file: string;
  url: string;
  sha256: string;
  bytes: number;
  /** the square size the model looks at */
  input: number;
  mean: [number, number, number];
  std: [number, number, number];
  licence: string;
  source: string;
}

export const CUTOUT_MODELS: Record<CutoutModelId, CutoutModel> = {
  fast: {
    id: 'fast', name: 'Quick', line: 'Small and fast; rougher edges.',
    file: 'u2netp.onnx', url: 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx',
    sha256: '309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8', bytes: 4_574_861,
    input: 320, mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225],
    licence: 'Apache-2.0', source: 'U²-Net (small), Qin et al.',
  },
  best: {
    id: 'best', name: 'Best', line: 'Cleaner edges around hair and fine detail.',
    file: 'isnet-general-use.onnx', url: 'https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx',
    sha256: '60920e99c45464f2ba57bee2ad08c919a52bbf852739e96947fbb4358c0d964a', bytes: 178_648_008,
    input: 1024, mean: [0.5, 0.5, 0.5], std: [1, 1, 1],
    licence: 'Apache-2.0', source: 'IS-Net (general use), Qin et al., Dichotomous Image Segmentation',
  },
};

/** Which model runs: the larger one when asked for and downloaded, else the small one. */
export function chooseModel(want: 'fast' | 'best', bestReady: boolean): CutoutModelId {
  return want === 'best' && bestReady ? 'best' : 'fast';
}

/** "178 MB" */
export const modelSize = (m: CutoutModel) => `${Math.round(m.bytes / 1_000_000)} MB`;
