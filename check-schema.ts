import "dotenv/config";
import pg from "pg";

const { Pool } = pg;

async function checkSchema() {
  const DATABASE_URL = process.env.DATABASE_URL;

  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: false,
  });

  try {
    const client = await pool.connect();

    console.log("\n📋 Checking actual database schema...\n");

    // Check persona_blocks
    const personaCheck = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'persona_blocks'
      ORDER BY ordinal_position
    `);

    console.log("persona_blocks table:");
    if (personaCheck.rows.length === 0) {
      console.log("  ❌ Table does not exist!");
    } else {
      personaCheck.rows.forEach(row => {
        console.log(`  - ${row.column_name} (${row.data_type}) ${row.is_nullable === 'NO' ? 'NOT NULL' : 'NULL'}`);
      });
    }

    // Check human_blocks
    const humanCheck = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'human_blocks'
      ORDER BY ordinal_position
    `);

    console.log("\nhuman_blocks table:");
    if (humanCheck.rows.length === 0) {
      console.log("  ❌ Table does not exist!");
    } else {
      humanCheck.rows.forEach(row => {
        console.log(`  - ${row.column_name} (${row.data_type}) ${row.is_nullable === 'NO' ? 'NOT NULL' : 'NULL'}`);
      });
    }

    // Check archival_memories
    const archivalCheck = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'archival_memories'
      ORDER BY ordinal_position
    `);

    console.log("\narchival_memories table:");
    if (archivalCheck.rows.length === 0) {
      console.log("  ❌ Table does not exist!");
    } else {
      archivalCheck.rows.forEach(row => {
        console.log(`  - ${row.column_name} (${row.data_type}) ${row.is_nullable === 'NO' ? 'NOT NULL' : 'NULL'}`);
      });
    }

    // Verify block_type specifically
    const blockTypeCheck = await client.query(`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE column_name = 'block_type'
      AND table_name IN ('persona_blocks', 'human_blocks')
    `);

    console.log("\n🔍 Verifying block_type column:");
    if (blockTypeCheck.rows.length === 2) {
      console.log("  ✅ block_type exists in both persona_blocks and human_blocks");
    } else {
      console.log("  ❌ block_type is MISSING from one or both tables!");
      blockTypeCheck.rows.forEach(row => {
        console.log(`     Found in: ${row.table_name}`);
      });
    }

    client.release();
    await pool.end();

    console.log("\n");
    process.exit(0);
  } catch (err) {
    console.error("\n❌ Check failed:");
    console.error(err);
    await pool.end();
    process.exit(1);
  }
}

checkSchema();
