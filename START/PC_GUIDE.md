# Sage Memory Parser — PC Setup Guide

> You will run two programs: the **embedder** (the thing that turns text into searchable vectors) and the **parser** (the thing that reads your conversations and sends them to the database). Both need to be running at the same time.
>
> Take it one section at a time. Every step is just "type this, press enter."

---

## What You'll Need First

**Before you start, make sure you have:**

- **Node.js 18 or newer** — [nodejs.org](https://nodejs.org) → download the LTS version, install it like any other program
- **A pgvector database on Railway** — see the Sage setup guide if you haven't done this yet. You'll need the public connection URL from your database.
- **Your conversation export files** — JSON from ChatGPT, Claude.ai, or Grok; or PDF, DOCX, TXT, or MD files

> To check if Node.js is installed: open a terminal and type `node --version`. If you see a number like `v20.x.x`, you're good.

---

## Step 1 — Download the Code

You need two repos: the embedder and the parser.

**Option A — GitHub (recommended):**
1. Go to the big-embedder repo on GitHub and click **Code → Download ZIP**
2. Go to the sage-parser repo on GitHub and click **Code → Download ZIP**
3. Unzip both somewhere easy to find (like your Desktop or a `Sage` folder)

**Option B — Git:**
```
git clone https://github.com/[your-org]/big-embedder
git clone https://github.com/[your-org]/sage-parser
```

---

## Step 2 — Set Up the Embedder

The embedder is a small server that runs on your computer and converts text into numbers. The parser talks to it when processing your files.

**Open a terminal in the big-embedder folder** (right-click the folder → "Open in Terminal" on Windows, or drag the folder onto Terminal on Mac).

Then run:

```
npm install
npm start
```

**The first time you run this, it will download a ~1.3 GB AI model.** This is normal. It only downloads once. Depending on your internet speed this might take a few minutes.

When it's ready you'll see something like:
```
✅ BIG model loaded
🚀 BIG EMBEDDER service listening on port 3001
```

**Leave this terminal open and running.** Don't close it. The parser needs it.

---

## Step 3 — Set Up the Parser

**Open a second terminal** in the sage-parser folder.

### Install dependencies

```
npm install
```

### Build the project

```
npm run build
```

### Fill in your settings

Open the `.env` file in the sage-parser folder (it's a plain text file — open it with Notepad, TextEdit, VS Code, anything).

Fill in these two lines:

```
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@YOUR_HOST/railway
EMBEDDER_URL=http://localhost:3001
```

- **DATABASE_URL** — get this from Railway → your pgvector service → **Variables** tab → look for `DATABASE_PUBLIC_URL`. Copy the whole thing.
- **EMBEDDER_URL** — leave this as `http://localhost:3001`. That's where the embedder you just started is running.

The other fields are optional:
- `ASSISTANT_NAME` — the name of your AI (e.g. `Sage`, `Ash`). Helps the parser figure out which side of the conversation is the AI when reading document files.
- `USER_NAME` — your name, same reason.

Save the file.

---

## Step 4 — Add Your Files

Put your conversation export files in the **`input`** folder inside sage-parser. If the folder doesn't exist, create it.

**Supported formats:**
- `conversations.json` — export from ChatGPT, Claude.ai, or Grok
- Any `.pdf`, `.docx`, `.txt`, or `.md` files — journals, notes, documents you want Sage to remember
- You can mix and match — just drop everything in the `input` folder

> If you're uploading documents (not conversation exports), name the files helpfully. If the filename contains your AI's name (e.g. `sage-notes.md`), the parser will recognize it as the AI's perspective. If it contains your name, it'll treat it as your perspective. Anything else goes into archival memories.

---

## Step 5 — Run the Parser

In your sage-parser terminal:

```
npm run parse
```

It will ask you:

```
Select dedupe mode:
  1) Accurate (recommended)
  2) Fast
```

Type `1` and press Enter.

Then it runs. You'll see it processing threads and generating embeddings. When it's done, you'll see something like:

```
✨ Data successfully written to database!
📝 Persona blocks: 142
👤 Human blocks: 89
📚 Archival memories: 1,847
```

That's it. Your database is populated and Sage can use it.

---

## Troubleshooting

**"Cannot connect to embedder"**
- Make sure the embedder terminal is still open and shows "listening on port 3001"
- Make sure `EMBEDDER_URL=http://localhost:3001` in your `.env`

**"DATABASE CONNECTION FAILED"**
- Double-check your `DATABASE_URL` in `.env` — it should be the **public** URL from Railway, not the internal one
- The internal URL contains `.railway.internal` — that one only works from inside Railway. You want the one with `.proxy.rlwy.net` in it.

**"Cannot find module" or build errors**
- Make sure you ran `npm install` and `npm run build` before `npm run parse`
- Make sure you're in the right folder

**The embedder is downloading something huge**
- That's the AI model (~1.3 GB). It only happens once. Wait for it.

**Nothing happened / output looks empty**
- Check that your files are actually in the `input` folder
- Make sure the files are in a supported format (JSON, PDF, DOCX, TXT, MD)

---

## Need Help?

Join the [Sin & Hex Discord](https://discord.gg/Pa2U2g5hUd) and post in the support channel with:
- Which step you got stuck on
- The exact error message from your terminal

You got this. 🖤
