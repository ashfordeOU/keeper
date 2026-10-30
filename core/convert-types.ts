// SPDX-License-Identifier: AGPL-3.0-or-later
// Every conversion Keeper can run. Outputs always go to a new folder and
// inputs are never changed.

export type VideoFormat = 'mp4' | 'webm' | 'mov' | 'gif';
export type AudioFormat = 'mp3' | 'm4a' | 'wav' | 'flac' | 'ogg';
export type ImageFormat = 'jpg' | 'png' | 'webp' | 'avif' | 'tiff' | 'gif';
export type VideoPreset = 'email' | 'discord' | 'whatsapp' | '720p' | '1080p';
export type HashAlgo = 'sha256' | 'sha1' | 'md5' | 'sha512';
export type Corner = 'center' | 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' | 'bottom-center';

export type ConvertOp =
  // video
  | { tool: 'video.compress'; targetMb: number }
  | { tool: 'video.preset'; preset: VideoPreset }
  | { tool: 'video.convert'; format: VideoFormat; width?: number; fps?: number }
  | { tool: 'video.trim'; start: number; end: number }
  | { tool: 'video.audio'; format: 'mp3' | 'm4a' }
  | { tool: 'video.mute' }
  | { tool: 'video.rotate'; degrees: 90 | 180 | 270 }
  | { tool: 'video.speed'; factor: number }
  | { tool: 'video.frames'; fps: number; format: 'jpg' | 'png' }
  // audio
  | { tool: 'audio.convert'; format: AudioFormat }
  | { tool: 'audio.normalize' }
  // images
  | { tool: 'image.convert'; format: ImageFormat; quality?: number }
  | { tool: 'image.resize'; maxSide?: number; percent?: number }
  | { tool: 'image.compress'; quality: number }
  | { tool: 'image.strip' }
  | { tool: 'image.rotate'; degrees: 90 | 180 | 270 }
  | { tool: 'image.watermark'; text: string; position: Corner; opacity: number }
  | { tool: 'image.toPdf'; pageSize: 'fit' | 'a4' | 'letter' }
  | { tool: 'image.removeBg' }
  // PDF
  | { tool: 'pdf.merge' }
  | { tool: 'pdf.split'; ranges?: string }
  | { tool: 'pdf.extract'; pages: string }
  | { tool: 'pdf.rotate'; degrees: 90 | 180 | 270; pages?: string }
  | { tool: 'pdf.reorder'; order: string }
  | { tool: 'pdf.delete'; pages: string }
  | { tool: 'pdf.number'; position: Corner; start?: number }
  | { tool: 'pdf.watermark'; text: string; opacity: number }
  | { tool: 'pdf.compress'; quality: number; maxSide: number }
  | { tool: 'pdf.encrypt'; password: string }
  | { tool: 'pdf.decrypt'; password: string }
  | { tool: 'pdf.toImages'; format: 'png' | 'jpg'; dpi: number }
  // any file
  | { tool: 'file.checksum'; algo: HashAlgo }
  | { tool: 'file.verify'; algo: HashAlgo; expected: string }
  | { tool: 'file.encrypt'; password: string }
  | { tool: 'file.decrypt'; password: string }
  | { tool: 'file.split'; sizeMb: number }
  | { tool: 'file.join' };

export type ConvertTool = ConvertOp['tool'];

export interface ConvertJob {
  op: ConvertOp;
  inputs: string[];
  /** a folder chosen by the user; by default a new "<name> (Keeper)" folder next to the input */
  outDir?: string;
}

export interface ConvertResult {
  outputs: string[];
  /** a sentence for the user, e.g. "Saved 12 MB" or "Checksums match" */
  message?: string;
  checksums?: { path: string; algo: HashAlgo; hash: string }[];
  verified?: boolean;
  /** inputs that could not be processed, with the reason */
  failed?: { path: string; reason: string }[];
}

export interface ConvertCapabilities {
  ffmpeg: boolean;
  qpdf: boolean;
  sips: boolean;
  bgRemoval: boolean;
  pdfRender: boolean;
}

export type ConvertCategory = 'video' | 'audio' | 'image' | 'pdf' | 'file';

/** What each tool accepts, so the interface only offers tools that fit the chosen files. */
export const TOOL_INFO: Record<ConvertTool, { category: ConvertCategory; label: string; description: string; accepts: string[]; multi?: boolean }> = {
  'video.compress': { category: 'video', label: 'Compress to a size', description: 'Shrink a video to fit a size limit, keeping it as sharp as possible.', accepts: ['video'] },
  'video.preset': { category: 'video', label: 'Make it fit', description: 'Ready-made sizes for e-mail, chat apps and HD.', accepts: ['video'] },
  'video.convert': { category: 'video', label: 'Convert', description: 'MP4, WebM, MOV or an animated GIF.', accepts: ['video'] },
  'video.trim': { category: 'video', label: 'Trim', description: 'Keep only the part between two times.', accepts: ['video', 'audio'] },
  'video.audio': { category: 'video', label: 'Extract audio', description: 'Save the soundtrack as MP3 or M4A.', accepts: ['video'] },
  'video.mute': { category: 'video', label: 'Remove sound', description: 'The same video without its audio.', accepts: ['video'] },
  'video.rotate': { category: 'video', label: 'Rotate', description: 'Turn a sideways video the right way up.', accepts: ['video'] },
  'video.speed': { category: 'video', label: 'Change speed', description: 'Speed up or slow down, sound included.', accepts: ['video'] },
  'video.frames': { category: 'video', label: 'Video to pictures', description: 'Save frames as images.', accepts: ['video'] },
  'audio.convert': { category: 'audio', label: 'Convert audio', description: 'MP3, M4A, WAV, FLAC or OGG.', accepts: ['audio', 'video'] },
  'audio.normalize': { category: 'audio', label: 'Even out volume', description: 'Make quiet and loud recordings sound alike.', accepts: ['audio'] },
  'image.convert': { category: 'image', label: 'Convert', description: 'JPEG, PNG, WebP, AVIF, TIFF or GIF — HEIC photos included.', accepts: ['image'] },
  'image.resize': { category: 'image', label: 'Resize', description: 'Make pictures smaller by size or percent.', accepts: ['image'] },
  'image.compress': { category: 'image', label: 'Compress', description: 'Smaller files that still look good.', accepts: ['image'] },
  'image.strip': { category: 'image', label: 'Remove location & details', description: 'Strip GPS, camera and other hidden data before sharing.', accepts: ['image'] },
  'image.rotate': { category: 'image', label: 'Rotate', description: 'Turn pictures by 90, 180 or 270 degrees.', accepts: ['image'] },
  'image.watermark': { category: 'image', label: 'Add a watermark', description: 'Put your name or a note on pictures.', accepts: ['image'] },
  'image.toPdf': { category: 'image', label: 'Pictures to PDF', description: 'One PDF with a page per picture.', accepts: ['image'], multi: true },
  'image.removeBg': { category: 'image', label: 'Remove background', description: 'Cut out the subject on this computer.', accepts: ['image'] },
  'pdf.merge': { category: 'pdf', label: 'Merge', description: 'Join PDFs into one, in the order shown.', accepts: ['pdf'], multi: true },
  'pdf.split': { category: 'pdf', label: 'Split', description: 'One PDF per page, or per range.', accepts: ['pdf'] },
  'pdf.extract': { category: 'pdf', label: 'Extract pages', description: 'Copy chosen pages into a new PDF.', accepts: ['pdf'] },
  'pdf.rotate': { category: 'pdf', label: 'Rotate pages', description: 'Turn all or some pages.', accepts: ['pdf'] },
  'pdf.reorder': { category: 'pdf', label: 'Reorder pages', description: 'Put pages in a new order.', accepts: ['pdf'] },
  'pdf.delete': { category: 'pdf', label: 'Delete pages', description: 'A copy without the pages you list.', accepts: ['pdf'] },
  'pdf.number': { category: 'pdf', label: 'Number pages', description: 'Add page numbers.', accepts: ['pdf'] },
  'pdf.watermark': { category: 'pdf', label: 'Add a watermark', description: 'Stamp text across every page.', accepts: ['pdf'] },
  'pdf.compress': { category: 'pdf', label: 'Compress', description: 'Smaller PDFs by re-saving their photos.', accepts: ['pdf'] },
  'pdf.encrypt': { category: 'pdf', label: 'Add a password', description: 'Only people with the password can open it.', accepts: ['pdf'] },
  'pdf.decrypt': { category: 'pdf', label: 'Remove a password', description: 'Save an unlocked copy (you need the password).', accepts: ['pdf'] },
  'pdf.toImages': { category: 'pdf', label: 'PDF to pictures', description: 'Every page as a PNG or JPEG.', accepts: ['pdf'] },
  'file.checksum': { category: 'file', label: 'Checksum', description: 'Fingerprint files to compare or verify downloads.', accepts: ['*'] },
  'file.verify': { category: 'file', label: 'Verify a download', description: 'Check a file against the checksum the website shows.', accepts: ['*'] },
  'file.encrypt': { category: 'file', label: 'Lock with a password', description: 'Encrypt any file so only the password opens it.', accepts: ['*'] },
  'file.decrypt': { category: 'file', label: 'Unlock', description: 'Decrypt a file locked by Keeper.', accepts: ['keeper-enc'] },
  'file.split': { category: 'file', label: 'Split a large file', description: 'Cut into parts that fit size limits.', accepts: ['*'] },
  'file.join': { category: 'file', label: 'Join parts', description: 'Put split parts back together.', accepts: ['*'] },
};
