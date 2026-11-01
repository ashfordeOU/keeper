// SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0
// Every conversion Keeper can run. Outputs always go to a new folder and
// inputs are never changed.

import { KIT_INFO } from './filekit/tools';

export type VideoFormat = 'mp4' | 'webm' | 'mov' | 'gif';
export type AudioFormat = 'mp3' | 'm4a' | 'wav' | 'flac' | 'ogg' | 'aiff';
export type ImageFormat = 'jpg' | 'png' | 'webp' | 'avif' | 'tiff' | 'gif' | 'heic';
export type VideoPreset = 'email' | 'discord' | 'whatsapp' | '720p' | '1080p';
export type HashAlgo = 'sha256' | 'sha1' | 'md5' | 'sha512';
export type Corner = 'center' | 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' | 'bottom-center';

export type ConvertOp =
  // video
  | { tool: 'video.compress'; targetMb: number }
  | { tool: 'video.preset'; preset: VideoPreset }
  | { tool: 'video.convert'; format: VideoFormat; width?: number; fps?: number }
  | { tool: 'video.trim'; start: number; end: number; /** cut on keyframes without re-encoding: instant and lossless */ lossless?: boolean }
  | { tool: 'video.audio'; format: 'mp3' | 'm4a' }
  | { tool: 'video.mute' }
  | { tool: 'video.rotate'; degrees: 90 | 180 | 270 }
  | { tool: 'video.speed'; factor: number }
  | { tool: 'video.frames'; fps: number; format: 'jpg' | 'png' }
  | { tool: 'video.merge' }
  | ({ tool: 'video.subtitles'; file?: string; auto?: boolean; fontSize: number } & SpeechOptions)
  | { tool: 'video.crop'; ratio: string; box?: { width: number; height: number; x: number; y: number } }
  | { tool: 'video.flip'; axis: 'h' | 'v' }
  | { tool: 'video.resize'; width: number; height: number; mode: 'exact' | 'fit' | 'fill' }
  | { tool: 'video.replaceAudio'; audio: string; mode: 'replace' | 'mix'; volume: number }
  | { tool: 'video.info' }
  // audio
  | { tool: 'audio.convert'; format: AudioFormat }
  | { tool: 'audio.normalize' }
  | { tool: 'audio.clean'; strength: 'light' | 'strong'; hum: 0 | 50 | 60 }
  | ({ tool: 'audio.transcribe'; format: 'txt' | 'timestamps' | 'srt' | 'vtt' } & SpeechOptions)
  // images
  | { tool: 'image.convert'; format: ImageFormat; quality?: number }
  | { tool: 'image.resize'; maxSide?: number; percent?: number; width?: number; height?: number }
  | { tool: 'image.compress'; quality: number }
  | { tool: 'image.strip' }
  | { tool: 'image.rotate'; degrees: 90 | 180 | 270 }
  | { tool: 'image.watermark'; text: string; position: Corner; opacity: number }
  | { tool: 'image.toPdf'; pageSize: 'fit' | 'a4' | 'letter' }
  | { tool: 'image.removeBg'; background?: string }
  | { tool: 'pdf.organize'; pages: import('./pdf-organize').OrganizePage[] }
  | { tool: 'image.scan'; mode: 'bw' | 'gray' | 'color'; pageSize: 'fit' | 'a4' | 'letter'; /** find the page's edges and pull it flat (default on) */ straighten?: boolean }
  | { tool: 'image.flip'; axis: 'h' | 'v' }
  | { tool: 'image.faces'; style: 'blur' | 'pixelate' | 'black' }
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
  | { tool: 'pdf.encrypt'; password: string; /** limits for people who open it with the password; an owner password is made up when none is given */ allowPrint?: boolean; allowCopy?: boolean; allowEdit?: boolean; ownerPassword?: string }
  | { tool: 'pdf.decrypt'; password: string }
  | { tool: 'pdf.toImages'; format: 'png' | 'jpg'; dpi: number }
  | { tool: 'pdf.redact'; words: string; caseSensitive: boolean; boxes?: { page: number; x: number; y: number; w: number; h: number }[] }
  | { tool: 'pdf.fill'; values: Record<string, string>; flatten: boolean; stamps?: { page: number; x: number; y: number; text: string; size?: number }[] }
  | { tool: 'pdf.sign'; signature: string; page: 'last' | number; corner: Corner; width: number; date: boolean }
  | { tool: 'pdf.searchable' }
  | { tool: 'pdf.toWord' }
  // documents
  | { tool: 'doc.toPdf'; pageSize: 'a4' | 'letter'; onePage: boolean }
  | { tool: 'doc.convert'; format: 'docx' | 'html' | 'md' | 'txt' }
  | { tool: 'doc.translate'; /** language code, e.g. "de" */ language: string; engine?: 'ai' | 'system' }
  | { tool: 'doc.speak'; voice?: string; rate: number; format: 'mp3' | 'm4a' | 'wav' }
  // any file
  | { tool: 'file.checksum'; algo: HashAlgo }
  | { tool: 'file.verify'; algo: HashAlgo; expected: string }
  | { tool: 'file.encrypt'; password: string }
  | { tool: 'file.decrypt'; password: string }
  | { tool: 'file.split'; sizeMb: number }
  | { tool: 'file.join' }
  | { tool: 'file.zip'; password?: string }
  | { tool: 'file.base64'; urlSafe?: boolean; wrap?: number }
  | { tool: 'file.unzip'; password?: string }
  // the file kit: more PDF tools and "Convert to…" for every format (core/filekit/tools.ts)
  | import('./filekit/tools').KitOp;

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
  /** text to show and copy (what is inside a media file, a transcript…) */
  details?: string;
}

export interface ConvertCapabilities {
  ffmpeg: boolean;
  qpdf: boolean;
  sips: boolean;
  bgRemoval: boolean;
  pdfRender: boolean;
  /** an office suite that converts documents (LibreOffice) */
  office?: boolean;
  /** speech output to a file */
  speech?: boolean;
  /** transcription is set up (on this computer or through the AI the person chose) */
  transcribe?: boolean;
  /** a dictation service is set up (the on-device model needs nothing) */
  transcribeService?: boolean;
  /** speech model sizes already downloaded */
  speechModels?: import('./whisper').WhisperSize[];
}

export type ConvertCategory = 'video' | 'audio' | 'image' | 'pdf' | 'doc' | 'file' | 'convert';

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
  'video.merge': { category: 'video', label: 'Join clips', description: 'One video from several, in the order shown — without re-encoding when the clips match.', accepts: ['video'], multi: true },
  'video.subtitles': { category: 'video', label: 'Burn in subtitles', description: 'Subtitles drawn into the picture, from an .srt/.vtt file or transcribed automatically.', accepts: ['video'] },
  'video.crop': { category: 'video', label: 'Crop', description: 'Square, portrait, wide or your own box.', accepts: ['video'] },
  'video.flip': { category: 'video', label: 'Flip', description: 'Mirror left–right or upside down.', accepts: ['video'] },
  'video.resize': { category: 'video', label: 'Resize', description: 'Exact pixel size, fit inside it, or fill it.', accepts: ['video'] },
  'video.replaceAudio': { category: 'video', label: 'Replace or add sound', description: 'New music or narration, instead of or mixed under the original.', accepts: ['video'] },
  'video.info': { category: 'video', label: 'What is inside', description: 'Codecs, size, frame rate, bitrate and details, to read or copy.', accepts: ['video', 'audio'] },
  'audio.convert': { category: 'audio', label: 'Convert audio', description: 'MP3, M4A, WAV, FLAC or OGG.', accepts: ['audio', 'video'] },
  'audio.normalize': { category: 'audio', label: 'Even out volume', description: 'Make quiet and loud recordings sound alike.', accepts: ['audio'] },
  'audio.clean': { category: 'audio', label: 'Clean up', description: 'Less background noise and mains hum, voices kept clear.', accepts: ['audio', 'video'] },
  'audio.transcribe': { category: 'audio', label: 'Transcribe', description: 'Speech to text, with times or as subtitles (.srt, .vtt).', accepts: ['audio', 'video'] },
  'image.convert': { category: 'image', label: 'Convert', description: 'JPEG, PNG, WebP, AVIF, TIFF or GIF — HEIC photos included.', accepts: ['image'] },
  'image.resize': { category: 'image', label: 'Resize', description: 'Make pictures smaller by size or percent.', accepts: ['image'] },
  'image.compress': { category: 'image', label: 'Compress', description: 'Smaller files that still look good.', accepts: ['image'] },
  'image.strip': { category: 'image', label: 'Remove location & details', description: 'Strip GPS, camera and other hidden data before sharing.', accepts: ['image'] },
  'image.rotate': { category: 'image', label: 'Rotate', description: 'Turn pictures by 90, 180 or 270 degrees.', accepts: ['image'] },
  'image.watermark': { category: 'image', label: 'Add a watermark', description: 'Put your name or a note on pictures.', accepts: ['image'] },
  'image.toPdf': { category: 'image', label: 'Pictures to PDF', description: 'One PDF with a page per picture.', accepts: ['image'], multi: true },
  'image.removeBg': { category: 'image', label: 'Remove background', description: 'Cut out the subject on this computer.', accepts: ['image'] },
  'pdf.organize': { category: 'pdf', label: 'Organize pages', description: 'See every page: drag to reorder, turn, remove, or add pages from other PDFs.', accepts: ['pdf'] },
  'image.scan': { category: 'image', label: 'Scan to PDF', description: 'Photos of pages, cleaned up (straightened edges trimmed, black and white or grey) into one PDF.', accepts: ['image'], multi: true },
  'image.flip': { category: 'image', label: 'Flip', description: 'Mirror left–right or upside down.', accepts: ['image'] },
  'image.faces': { category: 'image', label: 'Hide faces', description: 'Find faces on this computer and blur, pixelate or black them out.', accepts: ['image'] },
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
  'pdf.redact': { category: 'pdf', label: 'Redact', description: 'Black out words for good: the text under the boxes is removed, not covered, and details are stripped.', accepts: ['pdf'] },
  'pdf.fill': { category: 'pdf', label: 'Fill in a form', description: 'Fill the fields (or type anywhere), then flatten so answers cannot change.', accepts: ['pdf'] },
  'pdf.sign': { category: 'pdf', label: 'Sign', description: 'Draw or type your signature and place it on the page.', accepts: ['pdf'] },
  'pdf.searchable': { category: 'pdf', label: 'Make searchable', description: 'Read the text in scanned pages and add it invisibly, so you can search and copy.', accepts: ['pdf'] },
  'pdf.toWord': { category: 'pdf', label: 'PDF to Word', description: 'An editable .docx, page by page.', accepts: ['pdf'] },
  'doc.toPdf': { category: 'doc', label: 'To PDF', description: 'Word, PowerPoint, Excel, OpenDocument, web pages, Markdown and text as PDF.', accepts: ['document', 'code'] },
  'doc.convert': { category: 'doc', label: 'Convert', description: 'Between Word, HTML, Markdown and plain text.', accepts: ['document', 'code'] },
  'doc.translate': { category: 'doc', label: 'Translate', description: 'Whole documents and subtitles into another language, keeping their layout and timings (.docx, .md, .html, .txt, .srt, .vtt).', accepts: ['document', 'code', '*'] },
  'doc.speak': { category: 'doc', label: 'Read aloud to a file', description: 'Text, documents and PDFs as spoken audio (MP3, M4A or WAV).', accepts: ['document', 'code', 'pdf'] },
  'file.checksum': { category: 'file', label: 'Checksum', description: 'Fingerprint files to compare or verify downloads.', accepts: ['*'] },
  'file.verify': { category: 'file', label: 'Verify a download', description: 'Check a file against the checksum the website shows.', accepts: ['*'] },
  'file.encrypt': { category: 'file', label: 'Lock with a password', description: 'Encrypt any file so only the password opens it.', accepts: ['*'] },
  'file.decrypt': { category: 'file', label: 'Unlock', description: 'Decrypt a file locked by Keeper.', accepts: ['keeper-enc'] },
  'file.split': { category: 'file', label: 'Split a large file', description: 'Cut into parts that fit size limits.', accepts: ['*'] },
  'file.join': { category: 'file', label: 'Join parts', description: 'Put split parts back together.', accepts: ['*'] },
  'file.base64': { category: 'file', label: 'To Base64', description: 'A file as Base64 text (standard or URL-safe), for pasting into code or e-mail.', accepts: ['*'] },
  'file.zip': { category: 'file', label: 'Compress to ZIP', description: 'Files and folders in one ZIP, optionally with a password.', accepts: ['*'], multi: true },
  'file.unzip': { category: 'file', label: 'Unpack an archive', description: 'ZIP, TAR, TGZ, and 7z or RAR with the system’s archive tool.', accepts: ['*'] },
  ...KIT_INFO,
};

/**
 * Where speech becomes text: "device" runs a Whisper model on this computer
 * (every OS, downloaded once), "system" is macOS's own on-device recognizer,
 * "service" is the speech-to-text service chosen for dictation.
 */
export interface SpeechOptions { engine?: 'device' | 'system' | 'service'; model?: import('./whisper').WhisperSize; language?: string }
