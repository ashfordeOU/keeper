# Keeper tools: the full list, checked

This page checks Keeper against two common lists:

- a 94-tool everyday toolbox (video, audio, images, documents, text and speech, files, system and developer tools);
- the feature list of a typical screen-text-capture (OCR) app.

Each row says:

- where the tool lives in Keeper;
- its status;
- where Keeper does more.

**Status**

| Status | Meaning |
| --- | --- |
| **built** | Keeper does the same job. |
| **better** | Keeper does the same job and more (the last column says what). |
| **partial** | Keeper does most of it. The gap is written in the row. |
| **os-limit** | The operating system does not allow it, or does not allow it everywhere. The row says where it works. |

**Where things are**

- **Convert** is the Convert page: drop files, pick a tool. It is also in the command palette (`Ctrl/⌘ K`, type the tool name) and in the CLI (`keeper tool <name> <files>`).
- **Toolbox** is the Tools page, reached from the palette (`Ctrl/⌘ K`, type “Toolbox”). It is no longer in the sidebar: every tool is also a command in **Quick Search**, so typing “JSON formatter” or “hashes” there opens it.
- **Capture** is the Screen page's Capture tab and its shortcut.

Every Convert tool runs on your computer and works on many files at once. The CLI can run each one with `--json` output for scripts.

## Video (15)

| Tool | Where in Keeper | Status | How Keeper goes further |
| --- | --- | --- | --- |
| Download video | Toolbox › Media › Download video | better | Uses a pinned, checksum-checked downloader. Lets you pick quality or audio only, with progress you can cancel. The downloader is fetched only on first use, and the tool can be turned off in Features. |
| Burn in subtitles | Convert › Video › Burn in subtitles | better | Takes an SRT or VTT file, or makes subtitles from the speech first, on this computer. You set the font size. |
| Change speed | Convert › Video › Change speed | built | Voices keep their pitch (chained tempo filters for any speed). |
| Extract frames | Convert › Video › Extract frames | built | Every N seconds or a set number of frames. |
| Record screen | Capture › Record | built | Record a screen, window or area, with system sound and microphone where the OS allows. |
| Compress video | Convert › Video › Compress, Presets | better | Quality presets plus size targets for email and chat. |
| Convert video | Convert › Video › Convert | better | MP4, MOV, WebM, M4V, MKV and more. |
| Resize video | Convert › Video › Resize | better | Exact size, fit inside (adds bars) or fill (crops). |
| Crop and rotate video | Convert › Video › Crop, Rotate, Flip | better | Preset shapes (16:9, 9:16, 1:1, 4:5) or an exact box. |
| Media info | Convert › Video › Media info | better | Lists every stream with codec, size, frame rate, bit rate, audio channels and tags. Copy it with one click, or get it as JSON from the CLI. |
| Trim video | Convert › Video › Trim | better | Lossless cut with no re-encoding, or a frame-exact cut when you need one. |
| Merge videos | Convert › Video › Merge | better | Joins clips without re-encoding when they match. Otherwise it scales them to one size and adds silence to clips that have no sound. |
| Mute video | Convert › Video › Mute | built | No re-encoding. |
| Replace audio | Convert › Video › Replace audio | better | Replace the sound or mix it in, with separate volumes for the new and the original sound. |
| Video to GIF | Convert › Video › GIF | better | Uses a two-pass palette for clean colours. You set the frame rate and width. |

## Audio (5)

| Tool | Where in Keeper | Status | How Keeper goes further |
| --- | --- | --- | --- |
| Clean up audio | Convert › Audio › Clean up | better | Noise reduction in three strengths. Hum removal at 50 or 60 Hz, including its harmonics. Loudness evening is a separate tool. |
| Record audio | Toolbox › Media › Record your voice | better | Records, saves to Music/Keeper Recordings and transcribes in one step, on this computer, on every OS (a built-in speech model, downloaded once and checked). On macOS you can use the system's own recognizer instead, or any speech service you choose. |
| Trim audio | Convert › Video › Trim (accepts audio) | built | Lossless or exact. |
| Extract audio | Convert › Video › Extract audio | built | Choose the format. |
| Convert audio | Convert › Audio › Convert | better | MP3, M4A, WAV, FLAC, AIFF, OGG and Opus. |

## Images (11)

| Tool | Where in Keeper | Status | How Keeper goes further |
| --- | --- | --- | --- |
| Blur faces | Convert › Images › Hide faces | better | A face finder runs on your computer and splits large photos into tiles, so small faces in group photos are found too. Choose blur, pixelate or black boxes. The face model is downloaded once and its checksum is checked. |
| Beautify screenshot | Annotate › Background | better | Any background colour or gradient, padding, rounded corners and a shadow. Set a shape (16:9, 4:5, 1:1) and the picture stays centred. |
| Remove background | Convert › Images › Remove background | better | Runs on your computer. Keep it transparent or flatten it onto any colour. |
| Convert images | Convert › Images › Convert | better | JPEG, PNG, WebP, AVIF, TIFF and GIF on every OS, plus HEIC on macOS. |
| Compress images | Convert › Images › Compress | built | Quality slider and size report. |
| Resize images | Convert › Images › Resize | better | By percentage, by longest side, or to an exact width and height. |
| Rotate images | Convert › Images › Rotate, Flip | built | Many files at once. |
| Remove metadata | Convert › Images › Strip metadata | built | Removes location, camera and date details. |
| Colour picker | Toolbox › Colour picker, Colour converter | better | Pick from anywhere on screen. Convert between HEX, RGB, HSL and OKLCH, and check contrast. |
| Redact image | Annotate › Blur, Black out | built | Blur, pixelate or solid black. |
| Annotate screenshot | Annotate | better | Arrows, shapes, pen, highlighter, text, numbered steps, blur and black-out, with undo and redo. |

## Documents (22)

| Tool | Where in Keeper | Status | How Keeper goes further |
| --- | --- | --- | --- |
| Scan document | Convert › Images › Scan to PDF; phone companion › Scan a document | better | Finds each page's edges in the photo, pulls the page flat (perspective correction) and cleans it to black and white that copes with shadows, or to grey or colour. Many photos become one PDF. Pages can be photographed on a phone through Keeper Link's companion page, with no app to install, and the PDF is made on the computer. |
| Redact PDF | Convert › PDF › Redact | better | Real redaction. The page is redrawn as an image with the words burnt out, so nothing can be copied back, and the file details are removed. Phrases are found even when the PDF stores each letter separately. The CLI and API can also take exact boxes. |
| Fill and flatten forms | Convert › PDF › Fill form | better | Reads the fields in the form for you to fill in. It can also place text anywhere on pages that have no fields, then flatten the result. |
| Make PDF searchable | Convert › PDF › Make searchable | built | Adds an invisible text layer with the words in the right places (on-device text recognition). |
| PDF to Word | Convert › PDF › To Word | built | Keeps paragraphs and headings. Pages that are mostly pictures are kept as images. |
| Sign PDF | Convert › PDF › Sign | better | Draw or type your signature. It is kept for next time. Choose the page and corner, and optionally add the date. |
| Merge PDFs | Convert › PDF › Merge | built | Mix PDFs and images. |
| Split PDF | Convert › PDF › Split | built | Single pages or ranges. |
| Organize PDF | Convert › PDF › Organize pages | better | Every page as a thumbnail. Drag to reorder, turn left or right, remove, reverse, or add pages from other PDFs. Typed page lists (Reorder, Rotate, Delete) still work for big files and the CLI. |
| Delete pages | Convert › PDF › Delete pages | built | |
| Extract pages | Convert › PDF › Extract pages | built | |
| Images to PDF | Convert › Images › To PDF | built | |
| Compress PDF | Convert › PDF › Compress | built | |
| Add password | Convert › PDF › Add a password | better | AES-256. Optionally stops printing, copying and changes for people who open it. Keeper makes up an owner password nobody knows unless you give one, so the limits hold. Checked with qpdf and pdfinfo. |
| Remove password | Convert › PDF › Decrypt | built | |
| PDF to images | Convert › PDF › To images | built | PNG or JPEG at the resolution you choose. |
| Convert documents | Convert › Documents › Convert | better | Word, OpenDocument, RTF, HTML, text and Markdown. The Word↔HTML↔Markdown↔text conversions work with nothing extra installed. Other formats use an office suite if you have one. |
| Word to PDF | Convert › Documents › To PDF | built | Uses an office suite (LibreOffice, Word or Pages). Falls back to a built-in renderer for Word files. |
| Presentations to PDF | Convert › Documents › To PDF | built | Uses an office suite (LibreOffice, PowerPoint or Keynote). |
| Spreadsheets to PDF | Convert › Documents › To PDF | built | Uses an office suite (LibreOffice, Excel or Numbers). |
| Web page to PDF | Toolbox › Media › Web page to PDF | better | Paged A4 or Letter, or one long page with no breaks. Runs in a private, isolated window. |
| Markdown to PDF | Convert › Documents › To PDF | better | Tables, code blocks and images. Choose the page size, or one long page. |

## Text and speech (9)

| Tool | Where in Keeper | Status | How Keeper goes further |
| --- | --- | --- | --- |
| Transcribe | Convert › Audio › Transcribe | better | Runs on this computer on every OS, with a choice of fast, balanced or most accurate model and automatic language detection. Saves plain text, timestamped text, SRT or VTT. Can also use the macOS recognizer or any speech service with the common OpenAI-style interface. |
| Summarize | Inspector › Summarize; Assistant | better | Works with any AI model you set up, local or online, on every OS. |
| Extract text | Capture › From file / clipboard; Convert › PDF › Make searchable | better | Images, screenshots and scanned PDFs, in many languages, on every OS. |
| Capture text | Capture (shortcut) | better | Draw a box on screen and the text is copied. See the next table for details. |
| Translate | Convert › Documents › Translate; Assistant | better | One click translates whole Word, Markdown, web page and text files and subtitle files. Word files keep their styles, tables and pictures, Markdown its marks and code, web pages their tags, and subtitles their exact timings. Uses the AI you chose, which can be a local model so nothing leaves the computer, or macOS's own on-device translator (macOS 26 and later). |
| Text to speech | Convert › Documents › Speak; Toolbox › Speak | better | Turns text, Markdown, Word files and PDFs into MP3, M4A or WAV. Choose the voice and speed. Uses the speech built into each OS. |
| Ask a document | Assistant (Brain) | better | Answers questions across all your files, not only one, and says which file and page each answer comes from. |
| Word counter | Toolbox › Word counter | better | Words, characters, sentences, lines, reading time and most-used words. |
| Case converter | Toolbox › Change case | better | Title, sentence, lower, upper, camelCase, PascalCase, snake_case, kebab-case and CONSTANT_CASE. |

## Files (4)

| Tool | Where in Keeper | Status | How Keeper goes further |
| --- | --- | --- | --- |
| QR code | Toolbox › QR | better | Make QR codes, or read QR codes and barcodes from images, the screen or the clipboard. |
| Batch rename | Any file list › select files › right-click › Rename N items | better | Find/replace (with optional regex), prefix, suffix, case, numbering with padding, date tokens and extension changes. Every new name is previewed before anything changes on disk. |
| Find duplicates | Duplicates | better | Matches by content, picks which copy to keep, and moves the rest to Keeper's undoable trash. |
| Zip and unzip | Convert › Files › Zip, Unzip | better | Makes ZIP files with an optional password using the classic scheme, so any unzip tool can open them. ZIP and TAR(.gz) open without anything installed. RAR and 7z open through 7-Zip or similar if present. Unpacking blocks paths that would write outside the target folder. |

## System (16)

| Tool | Where in Keeper | Status | How Keeper goes further |
| --- | --- | --- | --- |
| Network speed test | Toolbox › Internet speed | built | Download, upload and latency, with a history of past tests. |
| Storage explorer | Space (folder map, iPhone and iPad backups), Large files, Cleanup | better | Folder map, largest files, and safe cleanup with undo. iPhone and iPad backups are listed with device name, model, iOS version, last backup date and size, and can be moved to the Trash. |
| Wi-Fi password and QR | Toolbox › Wi-Fi passwords | built | Shows the password and makes a join QR code. |
| Battery health | Health; Devices | built | Capacity, cycle count and accessory batteries. |
| Keep awake | Command palette; island | built | For a set time or until you stop it. |
| Uninstall app | Apps | better | Removes the app with its leftover files, after showing you a review list. |
| Presentation mode | Command palette › Presentation Mode | built | Hides desktop clutter, turns on do-not-disturb and keeps the computer awake. |
| Clean keyboard | Toolbox › Clean keyboard | better | Choose 30, 60 or 120 seconds and an optional black screen. |
| Dead pixel test | Toolbox › Dead-pixel test | built | Full-screen solid colours. |
| Eject all disks | Toolbox › Eject | built | |
| Login and background items | Startup | better | Covers macOS, Windows and Linux. Shows each item's impact on startup. |
| Fix "app is damaged" | Security › Quarantine; Toolbox | built | Clears the quarantine flag (macOS). |
| Reset permissions | Security › Permissions | built | Resets one app's privacy permissions (macOS). |
| Hidden settings | Toolbox › Tweaks | better | Includes macOS, Windows and GNOME settings, including mouse wheel speed, key repeat and natural scrolling. |
| Display control | Toolbox › Display control | better | Brightness, contrast and volume of external monitors over DDC/CI on all three OSs: Windows built in, macOS through Keeper's helper on Apple silicon (or m1ddc or ddcctl), Linux through ddcutil. |
| Mouse fixes | Toolbox › Tweaks | os-limit | Scroll direction and wheel speed on all three OSs. Windows can reverse only the mouse wheel. GNOME sets the mouse and touchpad separately. macOS shares one setting for the mouse and trackpad, so they cannot be set separately without a driver. Extra mouse buttons and shortcuts changed in one app are in Buttons & Shortcuts ([BUTTONS-AND-SHORTCUTS.md](BUTTONS-AND-SHORTCUTS.md)). |

## Developer (12)

| Tool | Where in Keeper | Status | How Keeper goes further |
| --- | --- | --- | --- |
| JSON formatter | Toolbox › JSON | built | Format, minify and validate. |
| Base64 | Toolbox › Base64 | better | Text or files, URL-safe mode and line wrapping. |
| Hash generator | Toolbox › Hash; Convert › Files › Checksum | better | MD5, SHA-1 and SHA-2, a compare box, and checking a checksum file. |
| UUID generator | Toolbox › UUID | better | v4 or v7, in bulk. The inspector shows the version and the time inside v1, v6 and v7 UUIDs. |
| JWT decoder | Toolbox › JWT | built | Header and claims, expiry, and HMAC signature check with your secret. |
| Timestamp converter | Toolbox › Timestamp | better | Seconds, milliseconds and microseconds, in any time zone. |
| Diff checker | Toolbox › Compare texts | better | Paste text or open files. View the changes inline or side by side, with changed lines paired up. |
| Regex tester | Toolbox › Regex | built | Live highlights and groups. |
| Clean links | Toolbox › Clean link | built | Removes tracking parameters and unwraps redirects. |
| Coordinate picker | Toolbox › Coordinates | better | Reads decimal, DMS, map links and `geo:` links. Shows the point in DMS, DDM, UTM, geohash and plus code, plus distance and bearing between two points. Place search is used only when you ask. There are no map tiles. |
| Unicode inspector | Toolbox › Unicode | built | Code points, names, hidden and look-alike characters. |
| Lorem ipsum | Toolbox › Placeholder text | built | 1 to 10 paragraphs as plain text, HTML or Markdown, with reshuffle and copy. |

## Screen-text capture

| Feature | Where in Keeper | Status | How Keeper goes further |
| --- | --- | --- | --- |
| Lives in the menu bar or tray | Tray and island | built | macOS, Windows and Linux. |
| Global capture shortcut | Settings › Shortcuts | built | You choose the shortcut. |
| Drag a box to read text | Capture | built | |
| Text goes straight to the clipboard | Capture | built | Shows a "Copied" message. |
| Accurate or fast mode | Capture settings | built | |
| Keep line breaks | Capture settings | built | |
| Language auto-detect | Capture options › Detect the language | built | On by default. macOS uses the system recognizer's own detection. Windows and Linux detect the writing system first, then pick the reader, and re-read Latin text in the language its words show. |
| Choose a language | Capture settings | better | Many languages, and several at once. |
| Handwriting | Capture | built | On macOS, capture uses the system's accurate recognizer, which reads neat handwriting as well as other apps do. On Windows and Linux the built-in reader handles print well but handwriting only roughly. |
| Scanned documents | Capture › From file; Convert › Make searchable | better | Can also add a text layer to the PDF for good. |
| QR codes and barcodes | Capture | built | |
| Open QR links automatically | Capture settings | built | Optional. |
| Spots links | Capture history › Links | built | |
| Reads images from the clipboard | Capture › From clipboard; `keeper://capture/clipboard` | built | |
| Opens PNG, JPEG and PDF files | Capture › From file; `keeper://capture/file?path=` | built | |
| Capture history | History | built | |
| Search history | History | built | |
| Filter history (all, text, links, QR, with counts) | History | built | |
| Clear history | History | built | |
| Automation links | `keeper://capture`, `keeper://capture/clipboard`, `keeper://capture/file`, `keeper://settings/<section>` | better | Also has a full CLI and a local API. |
| Works with launchers and shortcut apps | Links, CLI, Shortcuts actions (macOS) | better | |
| Launch at login | Settings | built | |
| Updates itself | Settings › Updates | built | You can also check for updates by hand. |
| Guided first run | Welcome tour | built | Setup asks what Keeper is for (up to three of eight goals), ends with one shortcut to remember, and Home shows one tip a day for the first week ([Setup](SETUP.md)). |
| Asks only for screen permission | Capture | built | Reads only the area you select. |
| Runs on your computer, works offline | Capture | built | No uploads, no account. |
| History stays on your computer | History | built | |
| Signed builds | Releases | built | Signed and notarized on macOS, and signed on Windows where certificates are set up. |
| Licence, price and refunds | — | — | Keeper is free to use (source-available under PolyForm Shield), so there is no licence to move between computers. |

## Totals

Toolbox list (94 tools):

| Status | Count |
| --- | --- |
| better | 55 |
| built | 38 |
| partial | 0 |
| os-limit | 1 |

Screen-text-capture list (28 features, not counting pricing):

| Status | Count |
| --- | --- |
| better | 4 |
| built | 24 |
| partial | 0 |

## Known gaps

- **Coordinates:** there are no map tiles. Place search and your location work on request.
- **Mouse and trackpad on macOS:** the system has one scroll-direction setting for both, so they cannot be set separately without a driver (os-limit).
- **Handwriting on Windows and Linux:** the built-in reader handles neat print, but rushed handwriting is rough there. macOS uses the system recognizer.

## How this was checked

- **Unit tests:**
  - `test/parity-core.test.ts`, `test/parity-tools.test.ts` and `test/parity-gaps.test.ts`.
  - The real speech model runs when `KEEPER_WHISPER_DIR` and `KEEPER_SPEECH_SAMPLE` are set.
  - PDF limits are checked with qpdf and pdfinfo when installed.
- **The real app on Linux** (`test/e2e/parity.cjs` under xvfb). It covers:
  - on-device transcription, including the model download, subtitles and burnt-in subtitles;
  - page straightening, and a phone scan through the companion page in an emulated phone browser;
  - drag-and-drop page organizing;
  - translation with a local model;
  - display contrast and volume through ddcutil;
  - phone backups, language detection for text capture, and PDF limits.
- **Only on macOS or Windows, not run here:**
  - macOS: the helper's speech, DDC and translation methods (`native/macos/KeeperHelper`, built by CI), HEIC output, and the Office and iWork conversions.
  - Windows: Monitor Configuration API control, SAPI voices and Office COM.
