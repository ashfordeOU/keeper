# AI agents in Keeper by Ashforde®

Keeper's brain (see [BRAIN.md](BRAIN.md)) already knows what is in your files. This layer lets **any** AI use it — chat assistants, coding agents, other harnesses, other agents, voice assistants — and lets them **do** things in Keeper, but only what you allow.

## What is here

| Part | What it does | Where |
| --- | --- | --- |
| AI services | ~30 services and distributors in one catalogue (Anthropic, OpenAI chat and Responses, Google Gemini, xAI Grok, Mistral, DeepSeek, Cohere, Moonshot, Qwen, Perplexity, OpenRouter, Together, Groq, Fireworks, Cerebras, Hugging Face, NVIDIA NIM, Azure OpenAI, Amazon Bedrock, Vertex AI, Ollama, LM Studio, llama.cpp, vLLM, Jan, LiteLLM-style gateways, any OpenAI- or Anthropic-compatible address). Live model lists, a test button, token and cost tracking (you enter prices). | Agents → AI services |
| Fallback | When the assistant's AI fails (network, rate limit, overload, a missing key), the next ticked connection answers. | Agents → AI services |
| Privacy routing | Once a conversation touches a folder you mark private, it continues on a local AI; text from those folders never reaches a cloud service. | Agents → AI services |
| Actions | Agents connected over MCP may move, rename, tag, create folders, send to the Trash, open files and apps, run automations, start the focus timer, read or write the clipboard, change a few settings, look at running programs, explain slowness, pause or quit programs. Each has Off / Ask / Allow. Ask shows a prompt in Keeper (and the Island) naming the agent and what it wants; no answer in two minutes means no. | Agents → What agents may do |
| History and undo | Every change an agent makes is in Keeper's History under the agent's name; `undo_last` (or History) puts moves and renames back. Files only ever go to the Trash. The list of what agents did — and were refused — is kept too. | Agents → What agents may do, History |
| Connect apps | One click adds Keeper to the Claude desktop app, Claude Code, Codex CLI, Gemini CLI, Cursor, VS Code, Windsurf, Zed, LM Studio, OpenClaw and Hermes Agent (each app's own settings file; a backup is made first). Copyable snippets for anything else. | Agents → Agents & apps |
| Start agents | Agent command-line tools found on this computer (Claude Code, Codex, Gemini CLI, Grok CLI, Cursor Agent, OpenClaw, Hermes, Copilot CLI, opencode, Aider, Goose, Qwen Code, Amp) start in Keeper's Terminal in a folder you choose. **Profiles** give an agent its own settings folder, so two accounts stay signed in side by side (Claude Code through `CLAUDE_CONFIG_DIR`, Codex through `CODEX_HOME`). | Agents → Agents & apps |
| Skills | Skills in the open Agent Skills format (a folder with `SKILL.md`). The assistant sees only names and descriptions until it decides to use one (`use_skill`), then reads its instructions and files. Connected agents get them as MCP prompts. Import skills from Claude Code, Codex or `~/.agents/skills`; export to share; **Save as skill** turns a good Assistant answer into a draft. | Agents → Skills |
| Model gateway | An OpenAI-compatible (`/v1/chat/completions`, `/v1/models`) and Anthropic-compatible (`/v1/messages`) endpoint on 127.0.0.1 with a token, off by default. Models: `keeper/<connection>`, `keeper/default`, and **`keeper/brain`**, which answers from your files with sources. Streaming works for both formats. | Agents → Gateway |
| Agent-to-agent | An A2A agent card (`/.well-known/agent-card.json`) and JSON-RPC endpoint (`/a2a`, `SendMessage` / `GetTask` / `CancelTask`, with the 0.3 names accepted too). Other agents hand Keeper tasks and get answers with sources. | Agents → Gateway |
| Editors | `keeper acp` makes Keeper an agent for editors that speak the Agent Client Protocol. | command line |
| Knowledge graph | Everything Keeper knows on this computer — files and notes, mail, people (one person however they are written), organisations, events, tasks and projects, meetings, places, saved pages — linked with the reason for each link (emailed, attended, mentioned in, attached to, linked, same project, tagged, near in time, same place, similar meaning). Existing Markdown vaults work as they are. Agents get `graph_neighbors` and `graph_search` over every kind; other AI apps see mail only from accounts shared with them. See [KNOWLEDGE-GRAPH.md](KNOWLEDGE-GRAPH.md). | Knowledge Graph |
| Learning | Off by default. Keeper notes opens, searches, moves and trashes made in Keeper — on this computer only — and suggests automations, pins and saved searches when something repeats. Retention you choose, and *Forget everything*. | Agents → Learning |
| Siri and Alexa | Siri: a Shortcut running `keeper ask --plain "…"` (or opening `keeper://ask`). Alexa: a custom-skill template in [`integrations/alexa`](../integrations/alexa) that reaches your Keeper through your own tunnel. | — |

## Connecting things

```bash
# Any app that speaks MCP over stdio
keeper mcp

# Claude Code, for every project
claude mcp add --scope user keeper -- keeper mcp

# Tools that speak the OpenAI API, through Keeper's gateway (turn it on first)
OPENAI_BASE_URL=http://127.0.0.1:<port>/v1 OPENAI_API_KEY=<token> your-tool

# An answer as plain text, for scripts and Siri Shortcuts
keeper ask --plain "When does my lease end?"
```

## Safety

- Reads first: an agent sees only the folders Keeper indexes, never excluded ones; secrets are blanked before text goes to an app connected over MCP.
- Changes ask by default, name the agent and the exact files, and can be declined. *Always allow* is per kind of action and can be taken back.
- Files are never deleted outright: only moved, renamed or sent to the Trash, and all of it is in History.
- The gateway and A2A answer only on 127.0.0.1 (plus host names you add for your own tunnel), need a token, refuse other host names (DNS rebinding) and web-page origins.
- Learning stays on this computer and is off until you turn it on.

## What was verified, and what was not

Verified here (Linux, real app under a virtual display, `test/e2e/agents.cjs`, 25 checks): the Assistant reading a skill only when it uses it; an agent over MCP asking to move a file, the approval prompt, the move, History under the agent's name, `undo_last`; a declined Trash request leaving the file alone; the knowledge graph linking notes both ways and showing a node's links; the gateway answering OpenAI- and Anthropic-style requests, `keeper/brain` streaming a cited answer, refusing requests without the token or for other host names; the A2A agent card and `SendMessage`. Unit tests (`test/agents.test.ts`) cover the wire formats of every adapter against a local fake server, fallback and privacy routing, the gateway translators, permissions, A2A, ACP, skills and progressive disclosure, learning rules, graph building and layout, and the Codex/Hermes/OpenClaw settings formats.

Not verified against the real services: no live call was made to Anthropic, OpenAI, Gemini, xAI, Bedrock, Azure, Vertex or any distributor; their adapters were tested only against local stand-ins that follow the documented formats. Bedrock uses a Bedrock **API key** with the Converse API; signing with AWS access keys (SigV4) is not built in — use a gateway for that. Vertex uses its OpenAI-compatible endpoint with a short-lived `gcloud` token. The config file locations for OpenClaw (`~/.openclaw/openclaw.json`, `mcp.servers`) and Hermes Agent (`~/.hermes/config.yaml`, `mcp_servers`) follow their published docs and were not tested with those apps installed. `keeper acp` follows the Agent Client Protocol v1 and was tested with a unit-level client, not inside an editor. The Alexa template was not run on a live device. Grok-based agents work through xAI's OpenAI-compatible API or their own CLI; there is no special Grok integration.
