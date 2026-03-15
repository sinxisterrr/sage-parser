# Continuum Parser Usage Guide

## Two Modes of Operation

### 1. File Mode (Default)
Outputs JSON files to `./output/` directory.

```bash
npm start input/conversations.json
```

This creates:
- `output/persona_blocks.json` - AI identity, behavior, relationships
- `output/human_blocks.json` - User identity, preferences, info
- `output/archival_memories.json` - Conversation events and memories
- `output/stats.json` - Discovery metadata

### 2. Database Mode (With Embeddings)
Writes directly to Postgres with vector embeddings.

**Requirements:**
- Postgres database with pgvector extension
- Embedding service running (see `/home/sinxisterrr/embedding-service`)

**Usage:**

```bash
# Using environment variables (recommended for Railway)
export DATABASE_URL="postgresql://user:pass@host:5432/dbname"
export EMBEDDER_URL="https://your-embedder.railway.app"
npm start input/conversations.json

# OR using CLI flags
npm start input/conversations.json \
  --database "postgresql://user:pass@host:5432/dbname" \
  --embedder "https://your-embedder.railway.app"
```

## Railway Deployment

### Setup Embedding Service

1. Deploy the embedding service first:
```bash
cd /home/sinxisterrr/embedding-service
# Push to Railway - it will auto-deploy
```

2. Note the public URL (e.g., `https://embedder-abc123.railway.app`)

### Setup Parser Service

1. Create a new Railway project
2. Add the parser repo
3. Set environment variables:
   - `DATABASE_URL` - Connection string to client's Postgres
   - `EMBEDDER_URL` - URL of your embedding service
4. Deploy

### Per-Client Setup

For each client:

1. They create a Railway project with Postgres
2. They give you the `DATABASE_URL` (public connection string)
3. You run the parser with their conversations.json:
   ```bash
   export DATABASE_URL="<client's postgres url>"
   export EMBEDDER_URL="<your embedder url>"
   npm start path/to/conversations.json
   ```
4. Done! Their DB is now populated with:
   - `persona_blocks` table - AI's self-concept
   - `human_blocks` table - User's info
   - `archival_memories` table - Event memories
   - All with 384D vector embeddings for semantic search

## Database Schema

### persona_blocks / human_blocks
```sql
id                SERIAL PRIMARY KEY
label             TEXT NOT NULL
block_type        TEXT NOT NULL
content           TEXT NOT NULL
description       TEXT
mira_type         TEXT
message_count     INTEGER
average_weight    NUMERIC
min_weight        NUMERIC
max_weight        NUMERIC
embedding         vector(384)  -- for similarity search
metadata          JSONB
created_at        TIMESTAMP
```

### archival_memories
```sql
id                TEXT PRIMARY KEY
content           TEXT NOT NULL
category          TEXT NOT NULL
importance        INTEGER NOT NULL
timestamp         BIGINT
tags              TEXT[]
mira_type         TEXT
message_weight    NUMERIC
embedding         vector(384)  -- for similarity search
metadata          JSONB
created_at        TIMESTAMP
```

## Querying the Data

### Find similar memories (cosine similarity)
```sql
SELECT content, category, importance,
       1 - (embedding <=> $1::vector) as similarity
FROM archival_memories
ORDER BY embedding <=> $1::vector
LIMIT 10;
```

### Get persona info
```sql
SELECT label, content, mira_type, average_weight
FROM persona_blocks
ORDER BY average_weight DESC;
```

### Get human info
```sql
SELECT label, content, mira_type, average_weight
FROM human_blocks
ORDER BY average_weight DESC;
```

## Flags & Options

- `--goblin` - Enable goblin mode (fun ASCII art)
- `--database <url>` - Enable database mode with connection string
- `--embedder <url>` - Embedding service URL (required with --database)

## Notes

- Weight data is now included in exports (min/max/average per block)
- Archival memories include individual message weights
- Embeddings are generated AFTER filtering/deduplication (saves cost)
- Parser filters junk content automatically (tool calls, image gen, etc.)
- MIRA classification splits content by type (identity, memory, relationship, agent)
