//--------------------------------------------------------------
// FILE: src/core/parse.ts
// Continuum Adaptive Parser — CLI Entry
//--------------------------------------------------------------

import "dotenv/config";
import fs from "fs";
import path from "path";

import { loadExport } from "./pipeline.js";
import { runFullPipeline } from "./pipeline.js";
import { printBanner } from "../ui/renderer.js";
import { askDedupeMode } from "../ui/renderer.js";
import { color, CYAN, GREEN, YELLOW, MAGENTA } from "../ui/colors.js";
import { DatabaseWriter } from "../db/writer.js";
import { EmbeddingClient } from "../db/embedder.js";

function getArgValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index !== -1 && index + 1 < process.argv.length) {
    return process.argv[index + 1];
  }
  return undefined;
}

async function main() {
  const inputPath = process.argv[2] || "./input";
  const GOBLIN = process.argv.includes("--goblin") || process.env.GOBLIN_MODE === "1";

  // Check for database mode
  const DATABASE_URL = process.env.DATABASE_URL || getArgValue("--database");
  const EMBEDDER_URL = process.env.EMBEDDER_URL || getArgValue("--embedder");
  const DATABASE_MODE = !!(DATABASE_URL && EMBEDDER_URL);

  printBanner(GOBLIN);

  const mode = await askDedupeMode(GOBLIN);

  console.log(color(`\n▶️  Starting Continuum Parser in ${mode.toUpperCase()} mode...\n`, GREEN));

  if (GOBLIN) console.log(color("[goblin-ash] 🧪 goblin mode engaged.\n", MAGENTA));

  if (DATABASE_MODE) {
    console.log(color("🗄️  Database mode enabled - will write to Postgres with embeddings\n", CYAN));

    // VERIFY DATABASE CONNECTION BEFORE PROCESSING
    console.log(color("🔌 Verifying database connection...", YELLOW));
    const testDb = new DatabaseWriter({ connectionString: DATABASE_URL! });
    try {
      await testDb.initialize();
      console.log(color("✅ Database connection successful!\n", GREEN));
      await testDb.close();
    } catch (err: any) {
      console.error(color("\n❌ DATABASE CONNECTION FAILED!", "red"));
      console.error(color("━".repeat(80), "red"));

      if (err.code === 'ENOTFOUND') {
        console.error(color("\n⚠️  HOSTNAME NOT FOUND", YELLOW));
        console.error(color(`   The database host "${err.hostname}" cannot be resolved.\n`, YELLOW));
        console.error(color("💡 Common causes:", CYAN));
        console.error(color("   1. You're using an INTERNAL Railway URL (*.railway.internal)", YELLOW));
        console.error(color("      → Get the PUBLIC URL from Railway Dashboard → Database → Variables", CYAN));
        console.error(color("      → Should look like: monorail.proxy.rlwy.net:XXXXX\n", CYAN));
        console.error(color("   2. Check your .env file has the correct DATABASE_URL", YELLOW));
        console.error(color("   3. Make sure you're connected to the internet\n", YELLOW));
      } else if (err.code === 'ECONNREFUSED') {
        console.error(color("\n⚠️  CONNECTION REFUSED", YELLOW));
        console.error(color("   The database server refused the connection.\n", YELLOW));
        console.error(color("💡 Common causes:", CYAN));
        console.error(color("   1. Database server is not running", YELLOW));
        console.error(color("   2. Wrong port number in DATABASE_URL", YELLOW));
        console.error(color("   3. Firewall blocking the connection\n", YELLOW));
      } else if (err.code === '28P01' || err.message?.includes('password')) {
        console.error(color("\n⚠️  AUTHENTICATION FAILED", YELLOW));
        console.error(color("   Invalid username or password.\n", YELLOW));
        console.error(color("💡 Solution:", CYAN));
        console.error(color("   Get the correct DATABASE_URL from Railway Dashboard\n", YELLOW));
      } else {
        console.error(color("\n⚠️  UNEXPECTED ERROR", YELLOW));
        console.error(err);
      }

      console.error(color("\n━".repeat(80), "red"));
      console.error(color("❌ Cannot proceed without database connection.", "red"));
      console.error(color("   Fix the connection issue and try again.\n", "red"));
      process.exit(1);
    }

    // VERIFY EMBEDDER CONNECTION
    console.log(color("🔌 Verifying embedder service...", YELLOW));
    const testEmbedder = new EmbeddingClient({ url: EMBEDDER_URL! });
    const isHealthy = await testEmbedder.checkHealth();
    if (!isHealthy) {
      console.error(color("\n❌ EMBEDDER SERVICE FAILED!", "red"));
      console.error(color(`   Cannot connect to embedder at ${EMBEDDER_URL}`, YELLOW));
      console.error(color("\n💡 Make sure the embedder service is running:", CYAN));
      console.error(color("   Run: npm start (in the embedder directory)\n", YELLOW));
      process.exit(1);
    }
    console.log(color("✅ Embedder service is healthy!\n", GREEN));
  }

  try {
    console.log(color(`📂 Loading export from: ${inputPath}`, CYAN));
    const root = await loadExport(inputPath);
    console.log(color(`   Loaded ${Object.keys(root.mapping).length} nodes`, GREEN));

    const result = await runFullPipeline(root, { mode, goblin: GOBLIN });

    console.log(color("\n✔️ Pipeline complete!\n", GREEN));
    console.log(`📝 Persona blocks: ${result.personaBlocks.length}`);
    console.log(`👤 Human blocks: ${result.humanBlocks.length}`);
    console.log(`📚 Archival memories: ${result.archivalMemories.length}`);

    if (DATABASE_MODE) {
      // Database mode - embed and write to Postgres

      // SAFETY CHECK: Test database writes with samples BEFORE embedding everything
      console.log(color("\n🧪 Running database write test with samples...\n", CYAN));

      const embedder = new EmbeddingClient({ url: EMBEDDER_URL! });
      const db = new DatabaseWriter({ connectionString: DATABASE_URL! });

      try {
        await db.initialize();

        // Test with 1 sample from each type
        const testPersona = result.personaBlocks.slice(0, 1);
        const testHuman = result.humanBlocks.slice(0, 1);
        const testArchival = result.archivalMemories.slice(0, 1);

        console.log(color("   Testing persona block write...", YELLOW));
        const testPersonaEmbed = await embedder.embedBatch(testPersona.map(b => b.content));
        await db.writePersonaBlocks(testPersona, testPersonaEmbed);
        console.log(color("   ✅ Persona block write successful", GREEN));

        console.log(color("   Testing human block write...", YELLOW));
        const testHumanEmbed = await embedder.embedBatch(testHuman.map(b => b.content));
        await db.writeHumanBlocks(testHuman, testHumanEmbed);
        console.log(color("   ✅ Human block write successful", GREEN));

        console.log(color("   Testing archival memory write...", YELLOW));
        const testArchivalEmbed = await embedder.embedBatch(testArchival.map(m => m.content));
        await db.writeArchivalMemories(testArchival, testArchivalEmbed);
        console.log(color("   ✅ Archival memory write successful", GREEN));

        console.log(color("\n🎉 All test writes succeeded! Proceeding with full embedding...\n", GREEN));

      } catch (err) {
        console.error(color("\n❌ DATABASE WRITE TEST FAILED!", "red"));
        console.error(color("This would have failed after 6 hours of embedding.", "red"));
        console.error(color("Fix the issue and try again.\n", "red"));
        console.error(err);
        await db.close();
        process.exit(1);
      }

      // Now do the full embedding and write
      console.log(color("🔮 Generating embeddings for all data...\n", CYAN));

      // Generate embeddings for all three data types
      const personaTexts = result.personaBlocks.map(b => b.content);
      const humanTexts = result.humanBlocks.map(b => b.content);
      const archivalTexts = result.archivalMemories.map(m => m.content);

      console.log(color("Embedding persona blocks...", CYAN));
      const personaEmbeddings = await embedder.embedBatch(personaTexts);

      console.log(color("Embedding human blocks...", CYAN));
      const humanEmbeddings = await embedder.embedBatch(humanTexts);

      console.log(color("Embedding archival memories...", CYAN));
      const archivalEmbeddings = await embedder.embedBatch(archivalTexts);

      console.log(color("\n💾 Writing to database...\n", CYAN));

      try {
        if (result.personaBlocks.length > 0) {
          await db.writePersonaBlocks(result.personaBlocks, personaEmbeddings);
        }

        if (result.humanBlocks.length > 0) {
          await db.writeHumanBlocks(result.humanBlocks, humanEmbeddings);
        }

        if (result.archivalMemories.length > 0) {
          await db.writeArchivalMemories(result.archivalMemories, archivalEmbeddings);
        }

        console.log(color("\n✨ Data successfully written to database!\n", GREEN));
      } finally {
        await db.close();
      }

    } else {
      // File mode - write JSON files
      const outDir = path.join(process.cwd(), "output");
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);

      fs.writeFileSync(path.join(outDir, "persona_blocks.json"), JSON.stringify(result.personaBlocks, null, 2));
      fs.writeFileSync(path.join(outDir, "human_blocks.json"), JSON.stringify(result.humanBlocks, null, 2));
      fs.writeFileSync(path.join(outDir, "archival_memories.json"), JSON.stringify(result.archivalMemories, null, 2));
      fs.writeFileSync(path.join(outDir, "stats.json"), JSON.stringify(result.discovery, null, 2));

      console.log(color("\n✨ Output written to ./output/\n", CYAN));
    }

  } catch (err) {
    console.error(color("\n❌ Parser failed:", YELLOW));
    if (GOBLIN) console.error(color("[goblin-ash] 💥 chaos detected.", MAGENTA));
    console.error(err);
    process.exit(1);
  }
}

// Always run main when this file is executed directly
main();
