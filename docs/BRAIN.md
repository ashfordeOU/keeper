# Keeper's brain

Keeper reads your files once, on your computer, and keeps what it learned ready for search and for any AI you use. This page explains what is stored, how search works, how AIs use it, and how other programs can connect.

## What is indexed

| Source | What Keeper reads |
|---|---|
| Every file in your library folders | name, folders, size, dates, kind, tags, where it was downloaded from |
| Word, PowerPoint, Excel (`docx`, `pptx`, `xlsx`), OpenDocument (`odt`, `ods`, `odp`), EPUB | the document text (Excel: shared strings and numbers) |
| PDF | text layer; scanned pages through on-device text recognition |
| Images and screenshots | text found by on-device text recognition (or the system's own, see [PLATFORM.md](PLATFORM.md)) |
| Text, Markdown, HTML, XML, JSON, YAML, CSV, notebooks, `.eml` e-mails, subtitles, RTF, source code | the text, up to 1 MB of text per file |

Excluded folders (**Settings → Library → Excluded**) are never read. Files kept only in the cloud are not downloaded to be read.

Text is split into **passages** of about 800 characters, cut at headings, paragraphs and sentences (source code at top-level declarations), overlapping slightly so a sentence cut in two is still found.

Everything lives in Keeper's data folder, in `brain/`:

| File | What it is |
|---|---|
| `brain.json` | passage positions and the word index |
| `vectors.bin` | meaning vectors (8-bit), when meaning search is on |
| `token` | the access token for the local channel and API (readable only by you) |
| `endpoint.json` | where the running app listens, for the `keeper` command |

The text itself is not copied: passages are read back from your files when they are shown.

## Search

Three signals are combined with reciprocal-rank fusion:

1. **Words** — a BM25 index over passages and over each file's name, folders, tags and source (names count more).
2. **Meaning** — when *Search by meaning* is on: [multilingual-e5-small](https://huggingface.co/intfloat/multilingual-e5-small) (MIT licence), 8-bit ONNX, 384 dimensions, run with ONNX Runtime on your computer. Downloaded once (about 129 MB) from a pinned revision and checked against known SHA-256 sums before use. Vectors are built in a background worker with few threads, newest files first, in small batches while you are using the computer and bigger ones when it is idle, and paused on battery if you like.
3. **Name and details** — the search bar's own ranking (every word must match name, tags, folder, source or text).

The search bar's filters apply to all three: *“pdfs from gmail last month”*, *“screenshots with wifi password”*, *“invoices over 1 MB”*.

Limits: the model is small. It is good at topics and paraphrases (*“money back when I move out”* → the deposit clause), weaker across languages in very short notes. Images are found by their text and names, not by what they show.

## Search by meaning over more than files

With the **Knowledge graph of everything** part on ([KNOWLEDGE-GRAPH.md](KNOWLEDGE-GRAPH.md)), the same on-device model also reads:

| Kind | What is read |
|---|---|
| Mail | the subject, the sender, and the text of messages already on this computer (others: their preview). Never Spam, Trash, sign-in codes or security mail. Secrets are blanked first |
| Calendar events | title, place, notes and who is invited |
| Tasks | title, notes and project |
| Contacts | name, organisation, addresses and the card's note |
| Notes | notes in Notes vaults outside your library folders (library notes are files already) |
| Meetings and saved pages | the transcript and notes; the page's summary |

Each item is one short document (its first 1,500 characters) with a word index and one meaning vector. Vectors are built in the same background batches as the files' — after them, newest first, small batches while you work, paused on battery if you like — and kept in `brain/items-vectors.bin` with `brain/items-keys.json`, so an unchanged email is never read twice. The same choices as the graph apply: a part that is off, mail switched off, an account or folder left out — those items leave the index and their vectors are deleted at the next look.

**One search box for every kind.** The Graph page's search, the Assistant's `search_everything` tool and `searchEverything` in the app rank files (from the brain) and every other kind (words and meaning, fused) together with reciprocal-rank fusion, so the best email can sit between two files. Each result carries what to cite: a file's path, or `keeper://mail/<id>`, `keeper://event/<id>`, `keeper://task/<id>`, `keeper://meeting/<id>`, `keeper://contact/<address>` or a web address. The Assistant cites these like files and shows them under the answer; clicking opens the email, event, task, meeting or person.

Without *Search by meaning*, the same search runs on words only.

### Searching pictures by what they show: evaluated, not added

Today pictures are found by their names and the text in them. Finding them by what they *show* (“dog on a beach”) needs a second, image-and-text model. What was weighed (figures from the models' own published results; not measured on Keeper's data):

| Model family | Download (8-bit) | Zero-shot accuracy (ImageNet) | Languages | Notes |
|---|---|---|---|---|
| CLIP ViT-B/32 (OpenCLIP, LAION-2B) | about 150 MB (image 88 MB + text 64 MB) | about 66 % | English | widely used; about 30 ms a picture on a laptop processor |
| MobileCLIP-S0 class (small mobile models) | about 55 MB | about 67 % | English | fastest; check the weights' licence before shipping |
| SigLIP base | about 200 MB | about 76 % | English | better matches; slower |
| Multilingual SigLIP / M-CLIP | 400 MB – 1.1 GB | 70 – 75 % | many | matches the multilingual text model, but large |

Trade-off: an English-only model of 55–150 MB would find most everyday scenes (pets, beaches, receipts, whiteboards) but not fine detail or other languages; a multilingual one costs four to seven times the download and roughly double the time per picture. Embedding a library of 50,000 pictures takes 30–60 minutes of background time on a laptop processor.

Recommendation: add it later as a downloadable component ([COMPONENTS.md](COMPONENTS.md)) with a pinned revision and SHA-256 sums, like `multilingual-e5-small`: an 8-bit OpenCLIP ViT-B/32 first (English, about 150 MB), with a multilingual model as a second choice. It is not part of this release because no model of this kind is pinned and checked yet.

## The assistant (harness)

The same assistant works with every AI. It gets these tools:

| Tool | Does |
|---|---|
| `search_files` | hybrid search with filters, kinds, folders and dates |
| `read_file` | a page of a file's text at a time |
| `list_folder` | what is in a folder |
| `file_info` | size, dates, kind, source, tags, pages, camera |
| `recent_activity` | downloaded, changed or opened recently |
| `largest_files`, `find_duplicates` | space questions |
| `propose_actions` | suggest trash / move / rename / tag / open — shown as buttons, never run by the AI |

- AIs that cannot use tools (and Apple's on-device model, which has a small context) get the best matches looked up first.
- Tool results are trimmed to the model's context size; older turns are shortened when a conversation grows.
- Paths outside your library folders, and excluded folders, are refused. Suggestions can only name files the AI was actually shown.
- Text inside files is treated as data; the AI is told to ignore instructions found in files.

### What AIs may see

| Setting | The AI gets |
|---|---|
| Names only | names, folders, sizes, dates, kinds, sources — nothing inside files |
| Matching passages (default) | plus the passages that matched, and up to 2,000 characters of a file it opens |
| Whole files | files it opens, page by page |

Before anything goes to an AI on the internet, **secrets are blanked**: private keys, API keys and tokens (Anthropic, OpenAI, AWS, Google, GitHub, Slack, Stripe, npm, JWTs, bearer tokens), passwords in “password: …” lines (several languages), connection strings with passwords, card numbers (Luhn-checked) and IBANs (checksum-checked). Turn on *Blank out secrets* to do the same for AIs on your computer. *Only use AIs on this computer* refuses any AI on the internet.

### Supported AIs

| AI | How |
|---|---|
| Claude | your Anthropic key; default model `claude-opus-5-5` |
| OpenAI | your OpenAI key |
| OpenRouter, Groq, Mistral, DeepSeek, Google Gemini, xAI, Azure OpenAI, any other OpenAI-format service | base address and key |
| Ollama, LM Studio, llama.cpp server, Jan | on this computer, no key |
| Apple Intelligence | macOS 26 on Apple silicon with Apple Intelligence on, through Keeper's helper |

Keys are stored encrypted by your system keychain. **Test** sends one short message to check a connection.

## Using Keeper from other AI apps (MCP)

Keeper speaks the [Model Context Protocol](https://modelcontextprotocol.io) (2025-06-18; older clients are answered in their version). Tools: `search_files`, `read_file`, `list_folder`, `file_info`, `recent_activity`, `largest_files`, `find_duplicates`, and `ask_keeper` (answers with the AI chosen in Keeper). All are read-only. Resources: `keeper://status`, each saved search as `keeper://saved/{id}`, and `keeper://search/{query}`.

**Settings → AI & Brain → Use Keeper from other AI apps → Connect** adds Keeper to the Claude desktop app, VS Code, Cursor, Windsurf, LM Studio or Zed. Keeper asks first, changes only its own entry, and saves the old file next to it as `….keeper-backup-<date>`. For other apps, copy the JSON entry or the `claude mcp add` command shown there.

The entry runs `keeper mcp`:

- **Keeper is running** — it connects to the app over a private channel (a Unix socket only you can open, or a Windows named pipe) with the token, so answers use the live brain, meaning search included.
- **Keeper is closed** — it loads the last saved library and brain read-only, catches up on changed files for up to 15 seconds in memory, and serves that. Asking (`ask_keeper`) then works only with AIs on this computer, since keys are kept by the app.

Secrets are blanked for connected apps by default (*Blank out secrets for connected apps*), because most AI apps send what they read to the internet.

## Local API

Off by default. When on, Keeper listens on `127.0.0.1` only (a fixed port if you set one, otherwise a free one; see `endpoint.json`). Every request needs `Authorization: Bearer <token>` (copy it in Settings). Requests with a browser `Origin` from another site, or a `Host` other than localhost, are refused.

| Method and path | Body / query | Returns |
|---|---|---|
| `POST /mcp` | a JSON-RPC message or batch | MCP over HTTP (JSON responses; `Mcp-Session-Id` on initialize) |
| `GET /v1/status` | — | `BrainStatus` |
| `GET /v1/search` | `q`, `limit`, `mode=hybrid\|words\|meaning` | `{ results: BrainHit[] }` |
| `GET /v1/read` | `path`, `offset`, `max` (≤ 100,000) | `{ text, total, truncated }` (secrets blanked unless turned off) |
| `POST /v1/ask` | `{ "question": "…" }` | `{ answer, sources, actions }` |

```bash
curl -H "Authorization: Bearer $TOKEN" "http://127.0.0.1:$PORT/v1/search?q=lease%20deposit"
```

`BrainHit`: `{ path, name, kind, size, mtime, score (0–1), snippet?, highlights?: [start, end][], heading?, source?, tags?, why?: ('words'|'meaning'|'name')[] }`.

## Command line

```text
keeper ask "when does my passport expire?"   answer with sources (through the app, or a local AI when it is closed)
keeper search --semantic "money back when I move out"
keeper search --brain "kubernetes migration"   words inside files and meaning
keeper brain                                    what the brain has read
keeper mcp                                      MCP over stdio
```

`--json` gives machine-readable output. `KEEPER_DATA_DIR` points the command at a different data folder.

## How it was checked

- Unit tests (`test/brain.test.ts`, `test/brain-io.test.ts`): passages, words, BM25, 8-bit vectors against float (and 200,000 passages searched in well under a second), the tokenizer against the reference implementation's ids, secret blanking, hybrid search with filters, the harness with a scripted AI (tools, refusals, secrets, no-tools mode, round limit), the OpenAI-format streaming parser, MCP over streams, office document text, settings files of AI apps, and `keeper mcp` with the app closed.
- `test/brain-items.test.ts`: the item index (words and meaning fused, newest first, only changed items embedded again, vectors kept across restarts, gone items lose theirs) and one ranked list with files, with citations.
- `test/e2e/brain.cjs` runs the real app under a virtual display with a stand-in AI: the brain reads a Word file, meaning search builds vectors in the worker, the Assistant's AI calls `search_files` and cites the lease, `keeper mcp` and `keeper ask` go through the running app, a Wi-Fi password is blanked, `/etc/passwd` is refused, and **Connect** keeps Cursor's other servers and makes a backup.
