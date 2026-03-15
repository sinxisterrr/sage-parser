# Sage Memory Parser — Railway Guide

> **No PC required.** This guide walks you through running the entire memory parser in the cloud using Railway. You'll end up with a private web page where you can upload your conversation exports and have Sage's memory database populated automatically — from any device, anywhere.

---

## What You're Setting Up

Three services, all inside one Railway project:

1. **pgvector** — the database where Sage's memories live
2. **big-embedder** — converts your conversations into searchable memory vectors
3. **sage-parser** — the web interface you'll use to upload your files

You set these up once. After that, using it is just: go to your URL, upload files, wait for it to finish.

---

## Accounts You Need

- **[Railway](https://railway.app)** — where everything runs. Free tier works to start, but you'll likely need the $5/month Hobby plan for the resources this uses.
- **[GitHub](https://github.com)** — where you'll fork the repos from

---

## Step 1 — Fork the Repos on GitHub

You need your own copies of two repos so Railway can deploy from them.

**Fork big-embedder:**
1. Go to the big-embedder repo on GitHub
2. Click **Fork** (top right) → **Create fork**

**Fork sage-parser:**
1. Go to the sage-parser repo on GitHub
2. Click **Fork** → **Create fork**

---

## Step 2 — Create Your Railway Project with pgvector

> You MUST use the pgvector template, not regular Postgres. The memory system requires it.

1. Go to [railway.app](https://railway.app) and log in
2. Click **New Project**
3. Click **Deploy a Template**
4. Search for **pgvector**
5. Select the one that just says **pgvector** (nothing after it)
6. Click **Deploy**
7. Wait for it to go **Online**

You now have a project with a database in it.

---

## Step 3 — Add the Embedder

The embedder is what turns your conversation text into searchable vectors. It has to finish loading before the parser can run.

1. Inside your Railway project, click **+ New**
2. Click **GitHub Repo**
3. Connect your GitHub account if asked
4. Select your forked **big-embedder** repo
5. Click **Deploy Now**

> ⚠️ **First deploy takes several minutes.** The embedder downloads a ~1.3 GB AI model on startup. The Railway log will say something like "Loading BIG embedding model" — this is normal. Wait for it to say **Online** before moving on.

---

## Step 4 — Add the Parser

1. Inside your Railway project, click **+ New** again
2. Click **GitHub Repo**
3. Select your forked **sage-parser** repo
4. Click **Deploy Now**
5. Wait for it to go **Online**

When it's online, click on the sage-parser service and go to the **Settings** tab. Find the **Public Domain** section and click **Generate Domain** — this gives you the URL for your parser web page.

Copy that URL. It'll look something like `sage-parser-production-xxxx.up.railway.app`.

---

## Step 5 — Get Your Connection Details

Before you can use the parser, you need two pieces of information from Railway.

### Your Database URL

1. In your Railway project, click on the **pgvector** service
2. Go to the **Variables** tab
3. Find `DATABASE_PUBLIC_URL` — copy the whole thing

It will look like:
```
postgresql://postgres:SOMEPASSWORD@monorail.proxy.rlwy.net:XXXXX/railway
```

### Your Embedder URL

This one you don't have to look up. Because the embedder is running in the same Railway project as the parser, they can talk to each other internally. The URL is always:

```
http://big-embedder.railway.internal:3000
```

> Make sure your big-embedder service is actually named **big-embedder** in Railway (it usually names itself after your repo, so if you forked it correctly it should be right). If it has a different name, the URL changes — check the service name in your Railway project.

---

## Step 6 — Configure the Parser

1. Open your sage-parser URL in a browser
2. At the top you'll see a **Connection** section — click it to expand
3. Paste your **Database URL** into the first field
4. The **Embedder URL** field should already say `http://big-embedder.railway.internal:3000` — leave it unless your service has a different name
5. Click **Save**

The section will collapse and show **· connected** in green.

These settings are saved in your browser. You only have to do this once.

---

## Step 7 — Upload Your Files

1. Click the upload area or drag your files onto it
2. Supported formats: **JSON** (ChatGPT, Claude.ai, Grok exports), **PDF**, **DOCX**, **TXT**, **MD**
3. You can upload multiple files at once
4. Click **Upload & Parse**

The page will show a progress bar and tell you what it's doing. The embedding step is the slow one — for large conversation exports it can take a while on Railway.

**You can close the tab.** The processing runs on the Railway server, not in your browser. Come back anytime and the page will pick up where it left off and show you the result.

When it's done, you'll see:

```
✓ Done! Your memories are in the database.

[ Memories ]  [ Persona ]  [ Human ]
   1,847         142          89
```

That's it. Sage's memory database is ready.

---

## Troubleshooting

**The embedder says "model not loaded yet"**
- It's still downloading the 1.3 GB model on first startup. Check the big-embedder logs in Railway and wait for it to finish.

**"Database connection failed" error**
- Make sure you used `DATABASE_PUBLIC_URL`, not `DATABASE_URL` — the internal URL only works from inside Railway's network, not from a web form
- Double-check you copied the full URL without cutting anything off

**Parser service won't go Online**
- Check its logs in Railway. If it says it can't find a module, try redeploying.
- Make sure the repo forked correctly (it should have a `package.json` with a `start` script)

**Progress bar is stuck for a long time**
- This is normal during the embedding step for large exports. Railway's embedder is slower than running locally. Just leave it open and let it run. Or close the tab — it'll finish on the server.

**"Job not found" when coming back to the page**
- Jobs are kept in memory for 10 minutes after finishing. If it's been longer than that, the job state is gone — but your memories are still in the database. Try running it again if you're not sure it finished.

---

## Need Help?

Join the [Sin & Hex Discord](https://discord.gg/Pa2U2g5hUd) and post in the support channel with:
- Which step you're stuck on
- A screenshot or copy-paste of any error messages

You got this. 🖤
