import "dotenv/config";
import pg from "pg";

const { Pool } = pg;

async function migrateDatabase() {
  const DATABASE_URL = process.env.DATABASE_URL;

  if (!DATABASE_URL) {
    console.error("❌ DATABASE_URL not set in .env");
    process.exit(1);
  }

  console.log("\n🔧 Migrating database schema...\n");

  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: false,
  });

  try {
    const client = await pool.connect();

    // Check if persona_blocks table exists and if it has block_type column
    const personaTableCheck = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'persona_blocks' AND column_name = 'block_type'
    `);

    if (personaTableCheck.rows.length === 0) {
      console.log("📝 Adding block_type column to persona_blocks...");
      await client.query(`
        ALTER TABLE persona_blocks
        ADD COLUMN IF NOT EXISTS block_type TEXT NOT NULL DEFAULT 'persona'
      `);
      console.log("✅ Added block_type to persona_blocks\n");
    } else {
      console.log("✅ persona_blocks already has block_type column\n");
    }

    // Check if human_blocks table exists and if it has block_type column
    const humanTableCheck = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'human_blocks' AND column_name = 'block_type'
    `);

    if (humanTableCheck.rows.length === 0) {
      console.log("📝 Adding block_type column to human_blocks...");
      await client.query(`
        ALTER TABLE human_blocks
        ADD COLUMN IF NOT EXISTS block_type TEXT NOT NULL DEFAULT 'human'
      `);
      console.log("✅ Added block_type to human_blocks\n");
    } else {
      console.log("✅ human_blocks already has block_type column\n");
    }

    // Verify all expected columns exist
    console.log("🔍 Verifying schema...");

    const personaColumns = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'persona_blocks'
      ORDER BY column_name
    `);

    console.log("\npersona_blocks columns:");
    personaColumns.rows.forEach(row => console.log(`  - ${row.column_name}`));

    const humanColumns = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'human_blocks'
      ORDER BY column_name
    `);

    console.log("\nhuman_blocks columns:");
    humanColumns.rows.forEach(row => console.log(`  - ${row.column_name}`));

    client.release();
    await pool.end();

    console.log("\n🎉 Migration complete! Ready to parse.\n");
    process.exit(0);
  } catch (err) {
    console.error("\n❌ Migration failed:");
    console.error(err);
    await pool.end();
    process.exit(1);
  }
}

migrateDatabase();
