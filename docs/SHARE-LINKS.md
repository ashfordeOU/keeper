<!-- SPDX-License-Identifier: LicenseRef-PolyForm-Shield-1.0.0 -->
# Share links

Studio can upload a finished video and copy a link to it. The link points into **your own storage**: a WebDAV server (Nextcloud, ownCloud, a NAS, any WebDAV folder) or an S3-compatible bucket (AWS S3, Cloudflare R2, Backblaze B2, MinIO, Wasabi…). Nothing is uploaded to Keeper or Ashforde, and nothing is uploaded until you choose a storage and ask for a link.

The storage is the one the Island's shelf already uses: **Island settings → Upload & share** (kind, address, bucket, key, folder, and how long S3 links work). The secret key or password is kept in the system keychain. Settings → General → Screen → "Where share links go" opens it.

## Studio: "Upload and copy link"

In Studio's **Export** dialog, choose **Upload and copy link** under the format choices, then **Export and Upload**. Keeper:

1. makes the video as usual and saves it next to the project (the upload never replaces the file on your computer);
2. uploads it into a new folder with a random name (so links cannot be guessed) inside the folder you chose in the settings;
3. uploads a small page, `index.html`, next to it;
4. copies the page's link, and the Island shows **Uploading** with progress, then **Link copied**.

A video that was exported before can be uploaded later with **Upload and copy link** on the finished export.

If the upload fails, the video is still saved and the dialog says what went wrong.

### The page

One static HTML file with nothing loaded from elsewhere (its Content Security Policy allows only the video itself):

- the player (or the picture, for a GIF);
- **chapters** from the project, in the finished video's time; click one to jump there;
- **captions** from the project, shown in the player (WebVTT made in the page) with a switch to turn them off;
- the **transcript**: the captions joined into paragraphs at pauses, each with its time to jump to;
- a **Download** button with the file's size;
- light and dark, following the viewer's system; usable with a keyboard and on a phone.

A page link can start at a moment: `…/index.html#t=90` starts 90 seconds in.

### How long a link works

| Storage | Choices | What happens at the end |
|---|---|---|
| S3-compatible | 1 day, 3 days, 7 days (the default comes from the settings) | The signed links to the page, the video and the download stop working. S3 signs links for at most 7 days. |
| WebDAV | No end, 1 day, 7 days, 30 days | The page says "This link has ended" instead of the player. The file itself stays on your server until you delete it, so this is a courtesy, not a lock. |

On WebDAV, the page finds the video by its name next to it, so it works under the public address you set ("Public link address") or under the server's own. On S3 every address in the page is signed.

**Not built:** a password on the page, and view counts. Both would need something running on a server, and Keeper keeps to plain files in your own storage.

## Platforms

All three. The upload is plain HTTPS from Keeper's main process (`fetch`), the same code the shelf uses.

## Files

| Part | File |
|---|---|
| The page, WebVTT, transcript paragraphs, link lifetimes, safe names | `core/share-page.ts` (`test/share-page.test.ts`) |
| Upload folders for WebDAV and S3, signed links with a download name | `electron/services/upload.ts`, `core/s3.ts` |
| Uploads, the Island activity, copying the link | `electron/services/share-link.ts` |
| Studio's export with a link | `electron/services/studio/exporter.ts`, `electron/ipc/studio.ts`, `src/studio/ExportDialog.tsx` |
| End to end (a local WebDAV server stands in for the storage) | `test/e2e/studio.cjs` |
