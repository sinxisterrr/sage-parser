import "dotenv/config";
import pg from "pg";

const { Pool } = pg;

async function resetDatabase() {
  const DATABASE_URL = process.env.DATABASE_URL;

  if (!DATABASE_URL) {
    console.error("❌ DATABASE_URL not set in .env");
    process.exit(1);
  }

  console.log("\n⚠️  This will DROP and recreate all continuum parser tables!");
  console.log("   Tables to be dropped:");
  console.log("   - persona_blocks");
  console.log("   - human_blocks");
  console.log("   - archival_memories\n");

  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: false,
  });

  try {
    const client = await pool.connect();

    console.log("🗑️  Dropping old tables...");
    await client.query("DROP TABLE IF EXISTS persona_blocks CASCADE");
    await client.query("DROP TABLE IF EXISTS human_blocks CASCADE");
    await client.query("DROP TABLE IF EXISTS archival_memories CASCADE");
    console.log("✅ Old tables dropped\n");

    console.log("📦 Creating fresh tables with correct schema...");

    // Enable pgvector extension
    await client.query("CREATE EXTENSION IF NOT EXISTS vector");

    // Create persona_blocks table (bastion-compatible)
    await client.query(`
      CREATE TABLE persona_blocks (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        content TEXT NOT NULL,
        mira_type TEXT,
        average_weight NUMERIC,
        min_weight NUMERIC,
        max_weight NUMERIC,
        message_count INTEGER,
        embedding vector(1024),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Create human_blocks table (bastion-compatible)
    await client.query(`
      CREATE TABLE human_blocks (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        content TEXT NOT NULL,
        mira_type TEXT,
        average_weight NUMERIC,
        min_weight NUMERIC,
        max_weight NUMERIC,
        message_count INTEGER,
        embedding vector(1024),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Create archival_memories table (bastion-compatible)
    await client.query(`
      CREATE TABLE archival_memories (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        content TEXT NOT NULL,
        category TEXT NOT NULL,
        importance INTEGER NOT NULL,
        timestamp BIGINT,
        state TEXT DEFAULT 'active',
        relevance_score NUMERIC DEFAULT 0.5,
        tags JSONB DEFAULT '[]'::jsonb,
        message_weight NUMERIC,
        mira_type TEXT,
        embedding vector(1024),
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    console.log("✅ Tables created\n");

    console.log("📊 Creating indexes...");

    // Regular indexes
    await client.query(`CREATE INDEX IF NOT EXISTS idx_archival_weight ON archival_memories(message_weight DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_archival_tags ON archival_memories USING GIN(tags)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_archival_importance ON archival_memories(importance DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_archival_state ON archival_memories(state)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_archival_mira_type ON archival_memories(mira_type)`);

    await client.query(`CREATE INDEX IF NOT EXISTS idx_persona_blocks_weight ON persona_blocks(average_weight DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_human_blocks_weight ON human_blocks(average_weight DESC)`);

    // Vector indexes (ivfflat for similarity search)
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_persona_embedding
      ON persona_blocks USING ivfflat (embedding vector_cosine_ops)
      WITH (lists = 100)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_human_embedding
      ON human_blocks USING ivfflat (embedding vector_cosine_ops)
      WITH (lists = 100)
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_archival_embedding
      ON archival_memories USING ivfflat (embedding vector_cosine_ops)
      WITH (lists = 100)
    `);

    console.log("✅ Indexes created\n");

    client.release();
    await pool.end();

    console.log("🎉 Database reset complete! Ready to parse.\n");
    process.exit(0);
  } catch (err) {
    console.error("\n❌ Reset failed:");
    console.error(err);
    await pool.end();
    process.exit(1);
  }
}

resetDatabase();
