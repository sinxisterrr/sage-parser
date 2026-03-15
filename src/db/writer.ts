//--------------------------------------------------------------
// FILE: src/db/writer.ts
// Database writer for Continuum Parser → Postgres with pgvector
//--------------------------------------------------------------

import pg from "pg";
import { PersonaBlock, ArchivalMemoryItem } from "../types/memory.js";

const { Pool } = pg;

export interface DatabaseConfig {
  connectionString: string;
}

export class DatabaseWriter {
  private pool: pg.Pool;

  constructor(config: DatabaseConfig) {
    this.pool = new Pool({
      connectionString: config.connectionString,
      ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
    });
  }

  // Generate a unique ID for blocks
  private generateBlockId(label: string, type: 'persona' | 'human'): string {
    const sanitized = label.toLowerCase().replace(/[^a-z0-9]+/g, '_');
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `${type}_${sanitized}_${timestamp}_${random}`;
  }

  async initialize(): Promise<void> {
    const client = await this.pool.connect();
    try {
      // Enable pgvector extension
      await client.query("CREATE EXTENSION IF NOT EXISTS vector");

      // Create persona_blocks table (bastion-compatible)
      await client.query(`
        CREATE TABLE IF NOT EXISTS persona_blocks (
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
        CREATE TABLE IF NOT EXISTS human_blocks (
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
        CREATE TABLE IF NOT EXISTS archival_memories (
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

      // Migration: Relax NOT NULL constraints on columns we don't populate
      // (e.g. block_type added by bastion but not used by the parser)
      for (const table of ['persona_blocks', 'human_blocks', 'archival_memories']) {
        try {
          const notNullCols = await client.query(`
            SELECT column_name FROM information_schema.columns
            WHERE table_name = $1 AND is_nullable = 'NO'
            AND column_name NOT IN ('id', 'label', 'content', 'category', 'importance')
          `, [table]);
          for (const row of notNullCols.rows) {
            await client.query(`ALTER TABLE ${table} ALTER COLUMN ${row.column_name} DROP NOT NULL`).catch(() => {});
          }
        } catch (e: any) {
          // table may not exist yet, that's fine
        }
      }

      // Migration: Ensure id columns are TEXT (older schemas may have INTEGER)
      for (const table of ['persona_blocks', 'human_blocks', 'archival_memories']) {
        try {
          const colCheck = await client.query(`
            SELECT data_type FROM information_schema.columns
            WHERE table_name = $1 AND column_name = 'id'
          `, [table]);
          if (colCheck.rows.length > 0 && colCheck.rows[0].data_type === 'integer') {
            console.log(`⚠️  Migrating ${table}.id from INTEGER to TEXT...`);
            await client.query(`ALTER TABLE ${table} ALTER COLUMN id TYPE TEXT USING id::TEXT`);
            console.log(`✅ ${table}.id migrated to TEXT`);
          }
        } catch (e: any) {
          console.log(`⚠️  Could not check/migrate ${table}.id: ${e.message}`);
        }
      }

      // Migration: Add any missing columns to existing tables
      const columnMigrations = [
        { table: "persona_blocks", column: "mira_type", type: "TEXT" },
        { table: "persona_blocks", column: "average_weight", type: "NUMERIC" },
        { table: "persona_blocks", column: "min_weight", type: "NUMERIC" },
        { table: "persona_blocks", column: "max_weight", type: "NUMERIC" },
        { table: "persona_blocks", column: "message_count", type: "INTEGER" },
        { table: "human_blocks", column: "mira_type", type: "TEXT" },
        { table: "human_blocks", column: "average_weight", type: "NUMERIC" },
        { table: "human_blocks", column: "min_weight", type: "NUMERIC" },
        { table: "human_blocks", column: "max_weight", type: "NUMERIC" },
        { table: "human_blocks", column: "message_count", type: "INTEGER" },
        { table: "archival_memories", column: "user_id", type: "TEXT" },
        { table: "archival_memories", column: "mira_type", type: "TEXT" },
        { table: "archival_memories", column: "message_weight", type: "NUMERIC" },
        { table: "archival_memories", column: "state", type: "TEXT DEFAULT 'active'" },
        { table: "archival_memories", column: "relevance_score", type: "NUMERIC DEFAULT 0.5" },
        { table: "archival_memories", column: "tags", type: "JSONB DEFAULT '[]'::jsonb" },
        { table: "archival_memories", column: "metadata", type: "JSONB DEFAULT '{}'::jsonb" },
      ];

      for (const m of columnMigrations) {
        await client.query(
          `ALTER TABLE ${m.table} ADD COLUMN IF NOT EXISTS ${m.column} ${m.type}`
        ).catch(() => {}); // ignore if already exists (older PG without IF NOT EXISTS)
      }

      // Migration: Check if we need to update from 384 to 1024 dimensions
      console.log("🔄 Checking for dimension migration...");

      // Force migration if FORCE_MIGRATION env var is set
      const forceMigration = process.env.FORCE_MIGRATION === 'true';

      if (forceMigration) {
        console.log("⚡ FORCE_MIGRATION=true - forcing migration to 1024D...");

        // Drop indexes first
        await client.query("DROP INDEX IF EXISTS persona_blocks_embedding_idx");
        await client.query("DROP INDEX IF EXISTS human_blocks_embedding_idx");
        await client.query("DROP INDEX IF EXISTS archival_memories_embedding_idx");

        // Alter column types
        await client.query("ALTER TABLE persona_blocks ALTER COLUMN embedding TYPE vector(1024) USING embedding::vector(1024)").catch(() => {
          // If conversion fails, set to NULL
          client.query("UPDATE persona_blocks SET embedding = NULL");
          client.query("ALTER TABLE persona_blocks ALTER COLUMN embedding TYPE vector(1024)");
        });

        await client.query("ALTER TABLE human_blocks ALTER COLUMN embedding TYPE vector(1024) USING embedding::vector(1024)").catch(() => {
          client.query("UPDATE human_blocks SET embedding = NULL");
          client.query("ALTER TABLE human_blocks ALTER COLUMN embedding TYPE vector(1024)");
        });

        await client.query("ALTER TABLE archival_memories ALTER COLUMN embedding TYPE vector(1024) USING embedding::vector(1024)").catch(() => {
          client.query("UPDATE archival_memories SET embedding = NULL");
          client.query("ALTER TABLE archival_memories ALTER COLUMN embedding TYPE vector(1024)");
        });

        console.log("✅ Forced migration complete: schema updated to 1024D");
      } else {
        // Auto-detect migration need
        try {
          // Check actual vector dimension in database
          const dimCheck = await client.query(`
            SELECT atttypmod
            FROM pg_attribute
            WHERE attrelid = 'archival_memories'::regclass
            AND attname = 'embedding'
          `);

          if (dimCheck.rows.length > 0) {
            // atttypmod for vector(n) is n + 4
            const currentDim = dimCheck.rows[0].atttypmod - 4;

            // Handle both 380 (bug) and 384 as "old dimensions needing migration"
            if (currentDim === 384 || currentDim === 380) {
              console.log("⚠️  Detected 384-dimensional vector column, migrating to 1024...");

              // Drop indexes first
              await client.query("DROP INDEX IF EXISTS persona_blocks_embedding_idx");
              await client.query("DROP INDEX IF EXISTS human_blocks_embedding_idx");
              await client.query("DROP INDEX IF EXISTS archival_memories_embedding_idx");

              // Clear embeddings first (incompatible dimensions)
              await client.query("UPDATE persona_blocks SET embedding = NULL");
              await client.query("UPDATE human_blocks SET embedding = NULL");
              await client.query("UPDATE archival_memories SET embedding = NULL");

              // Alter column types
              await client.query("ALTER TABLE persona_blocks ALTER COLUMN embedding TYPE vector(1024)");
              await client.query("ALTER TABLE human_blocks ALTER COLUMN embedding TYPE vector(1024)");
              await client.query("ALTER TABLE archival_memories ALTER COLUMN embedding TYPE vector(1024)");

              console.log("✅ Auto-migration complete: embeddings cleared, schema updated to 1024D");
            } else if (currentDim === 1024) {
              console.log("✅ Vector columns already at 1024 dimensions");
            } else {
              console.log(`ℹ️  Current dimension: ${currentDim} (no migration needed)`);
            }
          }
        } catch (error: any) {
          console.log(`⚠️  Could not detect dimension: ${error.message}`);
          console.log("   Assuming schema is correct or will be created fresh...");
        }
      }

      // Create regular indexes
      await client.query(`CREATE INDEX IF NOT EXISTS idx_archival_weight ON archival_memories(message_weight DESC)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_archival_tags ON archival_memories USING GIN(tags)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_archival_importance ON archival_memories(importance DESC)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_archival_state ON archival_memories(state)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_archival_mira_type ON archival_memories(mira_type)`);

      await client.query(`CREATE INDEX IF NOT EXISTS idx_persona_blocks_weight ON persona_blocks(average_weight DESC)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_human_blocks_weight ON human_blocks(average_weight DESC)`);

      // Create vector similarity indexes
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

      console.log("✅ Database tables and indexes created successfully");
    } finally {
      client.release();
    }
  }

  async writePersonaBlocks(blocks: PersonaBlock[], embeddings: number[][]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        const embedding = embeddings[i];
        const id = this.generateBlockId(block.label, 'persona');

        await client.query(
          `INSERT INTO persona_blocks
           (id, label, content, mira_type, average_weight, min_weight, max_weight,
            message_count, embedding)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            id,
            block.label,
            block.content,
            block.metadata?.miraType,
            block.metadata?.averageWeight,
            block.metadata?.minWeight,
            block.metadata?.maxWeight,
            block.metadata?.count,
            JSON.stringify(embedding),
          ]
        );
      }

      await client.query("COMMIT");
      console.log(`✅ Inserted ${blocks.length} persona blocks`);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async writeHumanBlocks(blocks: PersonaBlock[], embeddings: number[][]): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        const embedding = embeddings[i];
        const id = this.generateBlockId(block.label, 'human');

        await client.query(
          `INSERT INTO human_blocks
           (id, label, content, mira_type, average_weight, min_weight, max_weight,
            message_count, embedding)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            id,
            block.label,
            block.content,
            block.metadata?.miraType,
            block.metadata?.averageWeight,
            block.metadata?.minWeight,
            block.metadata?.maxWeight,
            block.metadata?.count,
            JSON.stringify(embedding),
          ]
        );
      }

      await client.query("COMMIT");
      console.log(`✅ Inserted ${blocks.length} human blocks`);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async writeArchivalMemories(
    memories: ArchivalMemoryItem[],
    embeddings: number[][]
  ): Promise<void> {
    const BATCH_SIZE = 500;
    let emptyCount = 0;
    const total = memories.length;
    let totalInserted = 0;
    let attempts = 0;
    console.log(`📝 Writing ${total} archival memories to database...`);

    for (let batchStart = 0; batchStart < total; batchStart += BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + BATCH_SIZE, total);
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");

        for (let i = batchStart; i < batchEnd; i++) {
          const memory = memories[i];
          const embedding = embeddings[i];

          if (!memory.content) emptyCount++;

          const metadataWithSource = {
            ...memory.metadata,
            source: 'parser',
            parsed_at: new Date().toISOString()
          };

          await client.query(
            `INSERT INTO archival_memories
             (id, user_id, content, category, importance, timestamp, state, relevance_score,
              tags, mira_type, message_weight, embedding, metadata)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
             ON CONFLICT (id) DO UPDATE SET
             content = EXCLUDED.content,
             category = EXCLUDED.category,
             importance = EXCLUDED.importance,
             embedding = EXCLUDED.embedding,
             metadata = EXCLUDED.metadata`,
            [
              memory.id,
              null,
              memory.content,
              memory.category,
              memory.importance,
              memory.timestamp ? Math.floor(memory.timestamp) : null,
              'active',
              0.5,
              JSON.stringify(memory.tags || []),
              memory.metadata?.miraType,
              memory.metadata?.weight,
              JSON.stringify(embedding),
              metadataWithSource,
            ]
          );
        }

        await client.query("COMMIT");
        totalInserted += (batchEnd - batchStart);
        console.log(`   Progress: ${totalInserted}/${total} memories written...`);
        attempts = 0; // success, reset for next batch
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        attempts++;
        if (attempts <= 2) {
          console.warn(`   ⚠️  Batch failed (attempt ${attempts}/3), retrying in 5 minutes...`);
          await new Promise(res => setTimeout(res, 5 * 60 * 1000));
          batchStart -= BATCH_SIZE; // retry same batch
        } else {
          throw err;
        }
      } finally {
        client.release();
      }
    }

    console.log(`✅ Inserted ${totalInserted} archival memories`);
    if (emptyCount > 0) {
      console.warn(`⚠️  Warning: ${emptyCount} memories had empty/null content`);
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
