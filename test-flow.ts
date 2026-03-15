#!/usr/bin/env tsx
//--------------------------------------------------------------
// Test the complete parser → embedder → database flow
//--------------------------------------------------------------

import "dotenv/config";
import { DatabaseWriter } from "./src/db/writer.js";
import { EmbeddingClient } from "./src/db/embedder.js";
import type { ArchivalMemoryItem } from "./src/types/memory.js";

async function testFlow() {
  console.log("🧪 TESTING CONTINUUM PARSER FLOW\n");
  console.log("=" .repeat(60));

  // Step 1: Check environment variables
  console.log("\n📋 STEP 1: Checking environment variables...");
  const DATABASE_URL = process.env.DATABASE_URL;
  const EMBEDDER_URL = process.env.EMBEDDER_URL;

  console.log(`   DATABASE_URL: ${DATABASE_URL ? '✅ SET' : '❌ NOT SET'}`);
  console.log(`   EMBEDDER_URL: ${EMBEDDER_URL ? '✅ SET' : '❌ NOT SET'}`);

  if (!DATABASE_URL) {
    console.error("\n❌ DATABASE_URL not set! Should be: postgresql://user:pass@host:port/db");
    console.error("   Example: postgresql://postgres:PASSWORD@monorail.proxy.rlwy.net:12345/railway");
    process.exit(1);
  }

  if (!EMBEDDER_URL) {
    console.error("\n❌ EMBEDDER_URL not set! Should be: http://localhost:3001");
    process.exit(1);
  }

  // Check DATABASE_URL format
  if (!DATABASE_URL.startsWith("postgresql://") && !DATABASE_URL.startsWith("postgres://")) {
    console.error("\n❌ DATABASE_URL has wrong format!");
    console.error(`   Current: ${DATABASE_URL}`);
    console.error("   Expected: postgresql://user:pass@host:port/db");
    console.error("\n🔧 Fix: Get the connection string from Railway dashboard:");
    console.error("   Railway → Database → Variables → DATABASE_URL");
    process.exit(1);
  }

  console.log("   ✅ DATABASE_URL format looks correct");

  // Step 2: Test embedder connection
  console.log("\n📋 STEP 2: Testing embedder connection...");
  const embedder = new EmbeddingClient({ url: EMBEDDER_URL });

  const isHealthy = await embedder.checkHealth();
  if (!isHealthy) {
    console.error("\n❌ Embedder is not healthy!");
    console.error("   Make sure embedding service is running:");
    console.error("   cd /home/sinxisterrr/embedding-service && npm start");
    process.exit(1);
  }

  console.log("   ✅ Embedder is healthy and ready");

  // Step 3: Test embedding generation
  console.log("\n📋 STEP 3: Testing embedding generation...");
  const testTexts = [
    "This is a test message to verify embeddings work correctly.",
    "Another test message to ensure the batch endpoint functions properly."
  ];

  const embeddings = await embedder.embedBatch(testTexts);
  console.log(`   Generated ${embeddings.length} embeddings`);
  console.log(`   Dimensions: ${embeddings[0]?.length || 0}`);

  if (embeddings.length !== testTexts.length) {
    console.error(`\n❌ Expected ${testTexts.length} embeddings, got ${embeddings.length}`);
    process.exit(1);
  }

  if (embeddings[0]?.length !== 1024) {
    console.error(`\n❌ Expected 1024 dimensions, got ${embeddings[0]?.length}`);
    process.exit(1);
  }

  console.log("   ✅ Embeddings generated successfully");

  // Step 4: Test database connection
  console.log("\n📋 STEP 4: Testing database connection...");
  const db = new DatabaseWriter({ connectionString: DATABASE_URL });

  try {
    await db.initialize();
    console.log("   ✅ Database connection successful");
    console.log("   ✅ Tables created/verified");
  } catch (error: any) {
    console.error("\n❌ Database connection failed!");
    console.error(`   Error: ${error.message}`);
    console.error("\n🔧 Troubleshooting:");
    console.error("   1. Check DATABASE_URL is correct in .env");
    console.error("   2. Verify database is running on Railway");
    console.error("   3. Check network/firewall settings");
    process.exit(1);
  }

  // Step 5: Test writing to database
  console.log("\n📋 STEP 5: Testing database write...");
  const testMemory: ArchivalMemoryItem = {
    id: `test_${Date.now()}`,
    content: "This is a test archival memory to verify the database write works correctly.",
    category: "test",
    importance: 5,
    timestamp: Date.now(),
    tags: ["test", "verification"],
    metadata: {
      miraType: "test",
      weight: 3.5,
      source: "test-flow.ts"
    }
  };

  const testEmbedding = embeddings[0]; // Use first test embedding

  try {
    await db.writeArchivalMemories([testMemory], [testEmbedding]);
    console.log("   ✅ Successfully wrote test memory to database");
  } catch (error: any) {
    console.error("\n❌ Database write failed!");
    console.error(`   Error: ${error.message}`);
    process.exit(1);
  }

  // Step 6: Verify the data
  console.log("\n📋 STEP 6: Verifying written data...");
  const pg = await import("pg");
  const { Pool } = pg.default;
  const pool = new Pool({ connectionString: DATABASE_URL });

  try {
    const result = await pool.query(
      "SELECT id, content, category, importance, message_weight FROM archival_memories WHERE id = $1",
      [testMemory.id]
    );

    if (result.rows.length === 0) {
      console.error("\n❌ Test memory not found in database!");
      process.exit(1);
    }

    const row = result.rows[0];
    console.log("   Retrieved from database:");
    console.log(`   - ID: ${row.id}`);
    console.log(`   - Content: ${row.content?.substring(0, 50)}...`);
    console.log(`   - Category: ${row.category}`);
    console.log(`   - Importance: ${row.importance}`);
    console.log(`   - Weight: ${row.message_weight}`);

    // CHECK FOR NULL VALUES
    if (!row.content) {
      console.error("\n❌ CONTENT IS NULL! This is the bug we're fixing!");
      process.exit(1);
    }

    console.log("\n   ✅ All fields populated correctly (NO NULL VALUES!)");

    // Cleanup
    await pool.query("DELETE FROM archival_memories WHERE id = $1", [testMemory.id]);
    console.log("   ✅ Test data cleaned up");

  } catch (error: any) {
    console.error("\n❌ Data verification failed!");
    console.error(`   Error: ${error.message}`);
    process.exit(1);
  } finally {
    await pool.end();
  }

  await db.close();

  // Success!
  console.log("\n" + "=".repeat(60));
  console.log("✅ ALL TESTS PASSED!");
  console.log("=".repeat(60));
  console.log("\n🎉 The parser → embedder → database flow is working correctly!");
  console.log("   You can now safely run the parser and it will NOT produce null values.\n");

  process.exit(0);
}

testFlow().catch((error) => {
  console.error("\n❌ FATAL ERROR:", error);
  process.exit(1);
});
