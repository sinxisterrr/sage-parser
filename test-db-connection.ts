import "dotenv/config";
import pg from "pg";

const { Pool } = pg;

async function testConnection() {
  const DATABASE_URL = process.env.DATABASE_URL;

  console.log("\n🔍 Testing database connection...");
  console.log(`URL: ${DATABASE_URL?.replace(/:[^:@]+@/, ':****@')}\n`);

  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: false, // Try without SSL first
  });

  try {
    console.log("Attempting connection...");
    const client = await pool.connect();
    console.log("✅ Connected successfully!");

    const result = await client.query("SELECT version()");
    console.log(`\n📊 PostgreSQL version: ${result.rows[0].version}\n`);

    client.release();
    await pool.end();

    process.exit(0);
  } catch (err: any) {
    console.error("\n❌ Connection failed!");
    console.error(`Error code: ${err.code}`);
    console.error(`Error message: ${err.message}\n`);

    if (err.code === 'ENOTFOUND') {
      console.error("💡 The hostname cannot be resolved.");
      console.error("   This means DNS lookup failed for:");
      console.error(`   ${err.hostname}\n`);
    } else if (err.code === 'ECONNREFUSED') {
      console.error("💡 Connection was refused by the server.");
      console.error("   The server might not be listening on this port.\n");
    } else if (err.code === 'ETIMEDOUT') {
      console.error("💡 Connection timed out.");
      console.error("   The server might be blocking external connections.\n");
    }

    await pool.end();
    process.exit(1);
  }
}

testConnection();
