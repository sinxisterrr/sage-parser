# Sage Memory Parser

Turn your AI conversation exports into a searchable, vector-embedded memory database.

The parser reads your chat history — from ChatGPT, Claude.ai, Grok, or plain document files — and extracts everything worth remembering: who your AI is, who you are, and what happened between you. It classifies, deduplicates, and embeds all of it into a PostgreSQL database with pgvector, ready for Sage to search semantically.

---

## What It Does

- **Reads** conversation exports (JSON, PDF, DOCX, TXT, MD)
- **Extracts** three types of data:
  - `persona_blocks` — the AI's identity, behavior, and self-concept
  - `human_blocks` — your identity, preferences, and information
  - `archival_memories` — episodic memories of things that happened
- **Classifies** everything using MIRA (Memory / Identity / Relationship / Agent)
- **Deduplicates** with Jaccard similarity clustering so repeated content doesn't bloat your database
- **Embeds** with 1024-dimensional vectors (via [big-embedder](../big-embedder)) for semantic similarity search
- **Writes** directly to your pgvector database

---

## Supported Formats

| Format | Notes |
|---|---|
| `conversations.json` | ChatGPT export |
| Claude.ai export JSON | Auto-detected |
| Grok export JSON | Auto-detected |
| `.pdf` | Text extracted automatically |
| `.docx` | Text extracted automatically |
| `.txt` / `.md` | Read verbatim |

You can mix formats — drop everything in the `input` folder and it processes all of it.

---

## Two Ways to Use It

### Option 1 — Railway (Web Interface)

Deploy it to Railway and use it from any browser. No PC required.

Upload files through a web page, watch the progress bar, come back when it's done. Processing runs on the server — closing the tab doesn't stop anything.

**→ See [START/RAILWAY_GUIDE.md](START/RAILWAY_GUIDE.md)**

### Option 2 — PC (Command Line)

Run it locally. Good if you have large exports or want to run it offline.

```bash
npm install
npm run build
# fill in .env with your DATABASE_URL and EMBEDDER_URL
npm run parse
```

**→ See [START/PC_GUIDE.md](START/PC_GUIDE.md)**

---

## Requirements

- **Node.js 18+**
- **PostgreSQL with pgvector** — get one free on [Railway](https://railway.app) using the pgvector template
- **[big-embedder](../big-embedder)** — must be running before you parse (handles the vector embeddings)

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string (public URL from Railway) |
| `EMBEDDER_URL` | Yes | URL of the big-embedder service |
| `ASSISTANT_NAME` | No | Your AI's name — helps classify document files |
| `USER_NAME` | No | Your name — same reason |

For Railway web mode, you set these in the browser — no Railway dashboard needed.

---

## Output

When run in CLI mode without a database, outputs JSON to `./output/`:

```
output/
  persona_blocks.json
  human_blocks.json
  archival_memories.json
  stats.json
```

In database mode, writes all three tables directly to your pgvector database with 1024-dimensional embeddings and creates the necessary indexes for semantic search.

---

## Part of the Sage Ecosystem

This parser is part of [Sage](https://discord.gg/Pa2U2g5hUd) — a Discord AI companion with persistent memory, voice, and an autonomous inner life.

If this is what we give away for free, [you should see what's behind the walls](https://discord.gg/Pa2U2g5hUd). 🖤

## Support Sin & Hex
[Sin & Hex](https://patreon.com/sinxhex] | [![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/Z8Z31W5CFK)
